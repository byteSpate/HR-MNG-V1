import { Prisma } from "../../generated/prisma/client"
import type { Prisma as PrismaNamespace } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import { postSystemJournal } from "../accounting/accounting.posting"
import { toLedgerDate } from "../accounting/accounting.utils"
import { loadRules } from "../posting/posting.rules"
import { assertDealAccess } from "./receivables.access"
import { assertReceivable } from "./receipt.allocation"
import { buildReceiptLines, receiptPosition } from "./receipt.posting"
import type { CertificatesInput, CreateReceiptInput } from "./receipt.validators"

export const RECEIPT_INCLUDE = {
  customer: { select: { id: true, legalName: true } },
  allocations: { include: { invoice: { select: { id: true, invoiceNumber: true } } } },
} satisfies Prisma.ReceiptInclude

function assertCertificates(input: {
  vdsAmount?: string; vdsCertificateRef?: string; vdsCertificateDate?: string
  aitAmount?: string; aitCertificateRef?: string; aitCertificateDate?: string
}) {
  const checks: Array<["VDS" | "AIT", string, string | undefined, string | undefined]> = [
    ["VDS", input.vdsAmount ?? "0", input.vdsCertificateRef, input.vdsCertificateDate],
    ["AIT", input.aitAmount ?? "0", input.aitCertificateRef, input.aitCertificateDate],
  ]
  for (const [label, amount, ref, date] of checks) {
    if (Boolean(ref) !== Boolean(date)) {
      throw new AppError(400, `Give the ${label} certificate's number and date together`)
    }
    if (ref && new Prisma.Decimal(amount).isZero()) {
      throw new AppError(400, `This receipt has no ${label === "VDS" ? "VAT" : "income tax"} withheld, so it has no ${label} certificate`)
    }
  }
}

/**
 * A receipt belongs to one deal (spec: every document belongs to one deal).
 * It posts and is saved APPROVED in the same step — there is no separate
 * draft/approve lifecycle any more (Task 6): the person who records a
 * receipt is trusted with the arithmetic the way a system journal already
 * is, and a mistake is corrected with a reversal, not a second approver.
 */
export async function createReceipt(input: CreateReceiptInput, actor: AccessTokenPayload) {
  assertCertificates(input)

  const amount = new Prisma.Decimal(input.amount)
  const vds = new Prisma.Decimal(input.vdsAmount ?? "0")
  const ait = new Prisma.Decimal(input.aitAmount ?? "0")
  const allocations = input.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: new Prisma.Decimal(a.amount) }))

  // Exactly, not "at most": a receipt with money left over is an advance
  // (removed, Task 3/4) and a receipt allocated past what it settles cannot
  // exist either.
  const { settled, allocated } = receiptPosition({ amount, vdsAmount: vds, aitAmount: ait, allocations })
  if (settled.greaterThan(allocated)) {
    throw new AppError(
      400,
      `This receipt is ${settled.minus(allocated).toFixed(2)} more than the invoices it pays. Money received before an invoice cannot be recorded. Create the invoice first.`
    )
  }
  if (allocated.greaterThan(settled)) {
    throw new AppError(400, "The invoices you picked add up to more than this receipt. Lower an amount.")
  }

  return prisma.$transaction(async (tx: PrismaNamespace.TransactionClient) => {
    const deal = await assertDealAccess(tx, actor, input.opportunityId)

    const customer = await tx.customer.findUnique({ where: { salesAccountId: deal.salesAccountId } })
    if (!customer) throw new AppError(400, `${deal.serial} has no customer yet, so a receipt cannot be recorded against it`)

    const invoiceIds = [...new Set(allocations.map((a) => a.invoiceId))]
    const invoices = await tx.invoice.findMany({
      where: { id: { in: invoiceIds } },
      select: { id: true, invoiceNumber: true, status: true, po: { select: { opportunityId: true } } },
    })
    const byId = new Map(invoices.map((i) => [i.id, i]))
    for (const invoiceId of invoiceIds) {
      const invoice = byId.get(invoiceId)
      if (!invoice) throw new AppError(404, "An invoice being collected does not exist")
      if (invoice.status !== "APPROVED") throw new AppError(409, `Invoice ${invoice.invoiceNumber} is not approved yet`)
      // Review Focus 1: two invoices can share a customer while belonging to
      // different deals. A receipt settles one deal, so an invoice from any
      // other deal is refused even when the customer matches.
      if (invoice.po.opportunityId !== deal.id) {
        throw new AppError(400, `Invoice ${invoice.invoiceNumber} is on a different deal. Record a separate receipt on that deal.`)
      }
    }

    // Re-checked here, not only above: this is the outstanding-balance and
    // customer-match check, re-run inside the transaction the same way
    // approval used to re-run it, since another receipt could have landed
    // on the same invoice between the check above and this write.
    await assertReceivable(tx, customer.id, allocations)

    const now = new Date()
    const receipt = await tx.receipt.create({
      data: {
        customerId: customer.id,
        opportunityId: deal.id,
        date: new Date(input.date),
        amount: amount.toFixed(2),
        vdsAmount: vds.toFixed(2),
        vdsCertificateRef: input.vdsCertificateRef ?? null,
        vdsCertificateDate: input.vdsCertificateDate ? new Date(input.vdsCertificateDate) : null,
        aitAmount: ait.toFixed(2),
        aitCertificateRef: input.aitCertificateRef ?? null,
        aitCertificateDate: input.aitCertificateDate ? new Date(input.aitCertificateDate) : null,
        reference: input.reference ?? null,
        status: "APPROVED",
        approvedBy: actor.sub,
        approvedAt: now,
        createdBy: actor.sub,
        allocations: { create: allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount.toFixed(2) })) },
      },
      include: RECEIPT_INCLUDE,
    })

    const rules = await loadRules(tx, "RECEIPT")
    await postSystemJournal(tx, {
      date: toLedgerDate(receipt.date),
      narration: `${receipt.customer.legalName}, receipt${receipt.reference ? ` ${receipt.reference}` : ""}`,
      source: { module: "CUSTOMER", refId: receipt.id, event: "RECEIPT" },
      lines: buildReceiptLines({ ...receipt, opportunityId: deal.id }, rules),
      createdBy: actor.sub,
    })

    await writeAudit(tx, {
      entity: "RECEIPT", entityId: receipt.id, action: "CREATE", changedBy: actor.sub,
      after: { amount: receipt.amount, vdsAmount: receipt.vdsAmount, aitAmount: receipt.aitAmount, opportunityId: deal.id },
    })
    return receipt
  })
}

export async function listReceipts(filter: { status?: "DRAFT" | "APPROVED"; certificates?: "missing" }) {
  const where =
    filter.certificates === "missing"
      ? {
          status: "APPROVED" as const,
          OR: [
            { vdsAmount: { gt: 0 }, vdsCertificateRef: null },
            { aitAmount: { gt: 0 }, aitCertificateRef: null },
          ],
        }
      : { status: filter.status }
  return prisma.receipt.findMany({ where, include: RECEIPT_INCLUDE, orderBy: { date: "desc" } })
}

/**
 * Withholding certificates arrive days after a receipt is approved (spec
 * §2: three working days for a Mushak 6.6), so they are recorded onto a
 * receipt of any status, never blocked on it still being a draft. A field
 * left out of `input` keeps its current value; sent as `null` it clears.
 */
export async function updateReceiptCertificates(id: string, input: CertificatesInput, actor: AccessTokenPayload) {
  const receipt = await prisma.receipt.findUnique({ where: { id } })
  if (!receipt) throw new AppError(404, "Receipt not found")

  const merged = {
    vdsAmount: receipt.vdsAmount,
    vdsCertificateRef: "vdsCertificateRef" in input ? input.vdsCertificateRef ?? null : receipt.vdsCertificateRef,
    vdsCertificateDate: "vdsCertificateDate" in input ? (input.vdsCertificateDate ? new Date(input.vdsCertificateDate) : null) : receipt.vdsCertificateDate,
    aitAmount: receipt.aitAmount,
    aitCertificateRef: "aitCertificateRef" in input ? input.aitCertificateRef ?? null : receipt.aitCertificateRef,
    aitCertificateDate: "aitCertificateDate" in input ? (input.aitCertificateDate ? new Date(input.aitCertificateDate) : null) : receipt.aitCertificateDate,
  }
  for (const [label, amount, ref, date] of [
    ["VDS", merged.vdsAmount, merged.vdsCertificateRef, merged.vdsCertificateDate],
    ["AIT", merged.aitAmount, merged.aitCertificateRef, merged.aitCertificateDate],
  ] as const) {
    if (Boolean(ref) !== Boolean(date)) throw new AppError(400, `Give the ${label} certificate's number and date together`)
    if (ref && new Prisma.Decimal(amount).isZero()) {
      throw new AppError(400, `This receipt has no ${label === "VDS" ? "VAT" : "income tax"} withheld, so it has no ${label} certificate`)
    }
  }

  const data: Record<string, unknown> = {}
  if ("vdsCertificateRef" in input) data.vdsCertificateRef = merged.vdsCertificateRef
  if ("vdsCertificateDate" in input) data.vdsCertificateDate = merged.vdsCertificateDate
  if ("aitCertificateRef" in input) data.aitCertificateRef = merged.aitCertificateRef
  if ("aitCertificateDate" in input) data.aitCertificateDate = merged.aitCertificateDate

  return prisma.$transaction(async (tx: PrismaNamespace.TransactionClient) => {
    const updated = await tx.receipt.update({ where: { id }, data, include: RECEIPT_INCLUDE })
    await writeAudit(tx, {
      entity: "RECEIPT", entityId: id, action: "UPDATE", changedBy: actor.sub,
      after: data as Prisma.InputJsonObject, note: "Withholding certificate recorded",
    })
    return updated
  })
}

export async function getReceipt(id: string) {
  const receipt = await prisma.receipt.findUnique({ where: { id }, include: RECEIPT_INCLUDE })
  if (!receipt) throw new AppError(404, "Receipt not found")
  return receipt
}
