import { Prisma } from "../../generated/prisma/client"
import type { Prisma as PrismaNamespace } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import type { SystemJournalInput } from "../accounting/accounting.types"
import { postReversalNow } from "../accounting/accounting.reversal"
import { resolveAccountCode } from "../posting/posting.rules"
import type { ResolvedRules } from "../posting/posting.types"

type Line = SystemJournalInput["lines"][number]

const ZERO = new Prisma.Decimal(0)

export interface ReceiptForPosting {
  id: string
  customerId: string
  // The one deal this receipt belongs to (Task 6). Every posted line
  // carries it, the same rule the supplier bill already follows.
  opportunityId: string
  amount: Prisma.Decimal
  vdsAmount: Prisma.Decimal
  aitAmount: Prisma.Decimal
  allocations: Array<{ amount: Prisma.Decimal }>
}

/** Settled (cash plus tax withheld) and allocated (invoices only). Lives
 *  here, not in receipt.service.ts, so this file never has to import back
 *  from the module it is itself imported by. */
export function receiptPosition(r: {
  amount: Prisma.Decimal
  vdsAmount: Prisma.Decimal
  aitAmount: Prisma.Decimal
  allocations: Array<{ amount: Prisma.Decimal }>
}) {
  const settled = new Prisma.Decimal(r.amount).plus(r.vdsAmount).plus(r.aitAmount)
  const allocated = r.allocations.reduce((s, a) => s.plus(a.amount), ZERO)
  return { settled, allocated }
}

/** Dr Bank for the cash, Dr VDS/AIT for what the customer kept, Cr
 *  Receivable for what the allocations cleared. Every taka a receipt
 *  settles must be allocated to an invoice up front (receipt.service.ts's
 *  createReceipt requires allocated === settled exactly — no advances). */
export function buildReceiptLines(receipt: ReceiptForPosting, rules: ResolvedRules): Line[] {
  const { allocated } = receiptPosition(receipt)

  const lines: Line[] = [{
    accountCode: resolveAccountCode(rules, "BANK"),
    debit: receipt.amount.toFixed(2),
    opportunityId: receipt.opportunityId,
  }]
  if (!receipt.vdsAmount.isZero()) {
    lines.push({
      accountCode: resolveAccountCode(rules, "VDS"), debit: receipt.vdsAmount.toFixed(2),
      customerId: receipt.customerId, opportunityId: receipt.opportunityId,
    })
  }
  if (!receipt.aitAmount.isZero()) {
    lines.push({
      accountCode: resolveAccountCode(rules, "AIT"), debit: receipt.aitAmount.toFixed(2),
      customerId: receipt.customerId, opportunityId: receipt.opportunityId,
    })
  }
  if (!allocated.isZero()) {
    lines.push({
      accountCode: resolveAccountCode(rules, "RECEIVABLE"), credit: allocated.toFixed(2),
      customerId: receipt.customerId, opportunityId: receipt.opportunityId,
    })
  }
  return lines
}

const REVERSE_INCLUDE = {
  customer: { select: { id: true, legalName: true } },
  allocations: { include: { invoice: { select: { id: true, invoiceNumber: true } } } },
} satisfies Prisma.ReceiptInclude

/**
 * Super Admin only (spec: a receipt no longer has a separate approval step,
 * so the only correction path left is a reversal). The receipt's journal is
 * found by the same source triple `postSystemJournal` used to post it —
 * a receipt carries no `journalId` column of its own, unlike a depreciation
 * run.
 */
export async function reverseReceipt(id: string, input: { reason: string }, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx: PrismaNamespace.TransactionClient) => {
    const receipt = await tx.receipt.findUnique({ where: { id } })
    if (!receipt) throw new AppError(404, "Receipt not found")
    if (receipt.status !== "APPROVED") {
      throw new AppError(
        409,
        receipt.status === "REVERSED"
          ? "This receipt is already reversed."
          : "This receipt is still a draft. There is nothing posted to reverse yet."
      )
    }

    const journal = await tx.journal.findFirst({
      where: { sourceModule: "CUSTOMER", sourceRefId: id, sourceEvent: "RECEIPT" },
      select: { id: true },
    })
    if (!journal) throw new AppError(409, "This receipt has no posted entry to reverse.")

    const reversal = await postReversalNow(tx, journal.id, input.reason, actor.sub)

    const updated = await tx.receipt.update({
      where: { id },
      data: { status: "REVERSED", reversedBy: actor.sub, reversedAt: new Date(), reversalReason: input.reason },
      include: REVERSE_INCLUDE,
    })

    await writeAudit(tx, {
      entity: "RECEIPT", entityId: id, action: "REVERSE", changedBy: actor.sub,
      before: { status: "APPROVED" }, after: { status: "REVERSED", reversedBy: reversal.journalNo },
      note: input.reason,
    })

    return updated
  })
}
