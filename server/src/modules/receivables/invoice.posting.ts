import { Prisma } from "../../generated/prisma/client"
import type { Prisma as PrismaNamespace, SaleLineKind } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import type { SystemJournalInput } from "../accounting/accounting.types"
import { postSystemJournal } from "../accounting/accounting.posting"
import { toLedgerDate } from "../accounting/accounting.utils"
import { loadRules, resolveAccountCode } from "../posting/posting.rules"
import type { ResolvedRules } from "../posting/posting.types"
import { poLineRemaining } from "./customerPo.service"
import { releaseCostForInvoice } from "./costRelease"
import { lockDeal } from "./receivables.position"
import { INVOICE_INCLUDE } from "./invoice.service"

type Line = SystemJournalInput["lines"][number]

export interface InvoiceForPosting {
  id: string
  customerId: string
  opportunityId: string
  lines: Array<{ amount: Prisma.Decimal; vatAmount: Prisma.Decimal; kind: SaleLineKind }>
}

/**
 * Delivery not tracked in 3a (spec §2, Track Delivery Off): one entry both
 * bills and earns, so no line ever touches 1221 Unbilled or 2170 Unearned.
 * Receivable and VAT keys come from the INVOICE rules; revenue comes from
 * the same EARNED rules a tracked delivery will use in 3b.
 */
export function buildInvoiceLines(invoice: InvoiceForPosting, invoiceRules: ResolvedRules, earnedRules: ResolvedRules): Line[] {
  const credits: Line[] = []
  let gross = new Prisma.Decimal(0)

  for (const line of invoice.lines) {
    credits.push({
      accountCode: resolveAccountCode(earnedRules, line.kind),
      credit: line.amount.toFixed(2),
      opportunityId: invoice.opportunityId,
    })
    if (!line.vatAmount.isZero()) {
      credits.push({
        accountCode: resolveAccountCode(invoiceRules, "VAT"),
        credit: line.vatAmount.toFixed(2),
        opportunityId: invoice.opportunityId,
      })
    }
    gross = gross.plus(line.amount).plus(line.vatAmount)
  }

  return [
    {
      accountCode: resolveAccountCode(invoiceRules, "RECEIVABLE"),
      debit: gross.toFixed(2),
      customerId: invoice.customerId,
      opportunityId: invoice.opportunityId,
    },
    ...credits,
  ]
}

export async function approveInvoice(id: string, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx: PrismaNamespace.TransactionClient) => {
    const head = await tx.invoice.findUnique({ where: { id }, select: { poId: true, po: { select: { opportunityId: true } } } })
    if (!head) throw new AppError(404, "Invoice not found")

    // Spec §3.5: events on one deal are serialised. Everything below reads
    // what earlier approvals on this deal left behind.
    await lockDeal(tx, head.po.opportunityId)

    const invoice = await tx.invoice.findUnique({
      where: { id },
      include: {
        po: { select: { id: true, serial: true, opportunityId: true } },
        lines: { include: { poLine: true } },
      },
    })
    if (!invoice) throw new AppError(404, "Invoice not found")
    if (invoice.status !== "DRAFT") throw new AppError(409, `This invoice is already ${invoice.status.toLowerCase()}`)
    if (invoice.createdBy === actor.sub) throw new AppError(403, "You prepared this invoice and cannot also approve it")

    const poLines = await tx.customerPoLine.findMany({
      where: { poId: invoice.poId },
      include: {
        invoiceLines: { where: { invoiceId: { not: id }, invoice: { status: { in: ["DRAFT", "APPROVED"] } } }, select: { amount: true } },
      },
    })
    const mine = new Map<string, Prisma.Decimal>()
    for (const l of invoice.lines) mine.set(l.poLineId, (mine.get(l.poLineId) ?? new Prisma.Decimal(0)).plus(l.amount))
    for (const poLine of poLines) {
      const wanted = mine.get(poLine.id)
      if (!wanted) continue
      const left = poLineRemaining(poLine)
      if (wanted.greaterThan(left)) throw new AppError(400, `Only ${left.toFixed(2)} is left to invoice on ${poLine.description}`)
    }

    const updated = await tx.invoice.update({
      where: { id },
      data: { status: "APPROVED", approvedBy: actor.sub, approvedAt: new Date() },
      include: INVOICE_INCLUDE,
    })

    const [invoiceRules, earnedRules] = await Promise.all([loadRules(tx, "INVOICE"), loadRules(tx, "EARNED")])
    await postSystemJournal(tx, {
      date: toLedgerDate(invoice.date),
      narration: `${updated.customer.legalName}, invoice ${invoice.invoiceNumber}`,
      source: { module: "CUSTOMER", refId: id, event: "INVOICE" },
      lines: buildInvoiceLines(
        {
          id, customerId: invoice.customerId, opportunityId: invoice.po.opportunityId,
          lines: invoice.lines.map((l) => ({ amount: l.amount, vatAmount: l.vatAmount, kind: l.poLine.kind })),
        },
        invoiceRules, earnedRules
      ),
      createdBy: actor.sub,
    })
    await releaseCostForInvoice(tx, id, actor.sub)

    // Complete when approved invoices (this one included) cover every line.
    const approved = await tx.customerPoLine.findMany({
      where: { poId: invoice.poId },
      include: { invoiceLines: { where: { invoice: { status: "APPROVED" } }, select: { amount: true } } },
    })
    if (approved.every((l) => poLineRemaining(l).lessThanOrEqualTo(0))) {
      await tx.customerPo.update({ where: { id: invoice.poId }, data: { status: "COMPLETE" } })
    }

    await writeAudit(tx, { entity: "INVOICE", entityId: id, action: "APPROVE", changedBy: actor.sub })
    return updated
  })
}
