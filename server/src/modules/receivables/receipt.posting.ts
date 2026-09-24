import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import type { SystemJournalInput } from "../accounting/accounting.types"
import { postSystemJournal } from "../accounting/accounting.posting"
import { toLedgerDate } from "../accounting/accounting.utils"
import { loadRules, resolveAccountCode } from "../posting/posting.rules"
import type { ResolvedRules } from "../posting/posting.types"
import { assertReceivable } from "./receipt.allocation"
import { receiptPosition } from "./receipt.service"

type Line = SystemJournalInput["lines"][number]

export interface ReceiptForPosting {
  id: string
  customerId: string
  amount: Prisma.Decimal
  vdsAmount: Prisma.Decimal
  aitAmount: Prisma.Decimal
  allocations: Array<{ amount: Prisma.Decimal }>
}

/** Dr Bank for the cash, Dr VDS/AIT for what the customer kept, Cr
 *  Receivable for what the allocations cleared. Every taka a receipt
 *  settles must be allocated to an invoice up front — see
 *  receipt.service.ts's check that allocated >= settled. */
export function buildReceiptLines(receipt: ReceiptForPosting, rules: ResolvedRules): Line[] {
  const { allocated } = receiptPosition(receipt)

  const lines: Line[] = [{ accountCode: resolveAccountCode(rules, "BANK"), debit: receipt.amount.toFixed(2) }]
  if (!receipt.vdsAmount.isZero()) {
    lines.push({ accountCode: resolveAccountCode(rules, "VDS"), debit: receipt.vdsAmount.toFixed(2), customerId: receipt.customerId })
  }
  if (!receipt.aitAmount.isZero()) {
    lines.push({ accountCode: resolveAccountCode(rules, "AIT"), debit: receipt.aitAmount.toFixed(2), customerId: receipt.customerId })
  }
  if (!allocated.isZero()) {
    lines.push({ accountCode: resolveAccountCode(rules, "RECEIVABLE"), credit: allocated.toFixed(2), customerId: receipt.customerId })
  }
  return lines
}

export async function approveReceipt(id: string, actor: AccessTokenPayload) {
  const receipt = await prisma.receipt.findUnique({
    where: { id },
    include: { allocations: true, customer: { select: { legalName: true } } },
  })
  if (!receipt) throw new AppError(404, "Receipt not found")
  if (receipt.status !== "DRAFT") throw new AppError(409, `This receipt is already ${receipt.status.toLowerCase()}`)
  if (receipt.createdBy === actor.sub) throw new AppError(403, "You prepared this receipt and cannot also approve it")

  return prisma.$transaction(async (tx) => {
    // Re-checked here, not only at draft time: another receipt against the
    // same invoice may have been approved in between.
    await assertReceivable(
      tx, receipt.customerId,
      receipt.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount }))
    )

    const updated = await tx.receipt.update({
      where: { id },
      data: { status: "APPROVED", approvedBy: actor.sub, approvedAt: new Date() },
      include: { allocations: true, customer: { select: { legalName: true } } },
    })

    const rules = await loadRules(tx, "RECEIPT")
    await postSystemJournal(tx, {
      date: toLedgerDate(receipt.date),
      narration: `${receipt.customer.legalName}, receipt${receipt.reference ? ` ${receipt.reference}` : ""}`,
      source: { module: "CUSTOMER", refId: id, event: "RECEIPT" },
      lines: buildReceiptLines(receipt, rules),
      createdBy: actor.sub,
    })
    await writeAudit(tx, { entity: "RECEIPT", entityId: id, action: "APPROVE", changedBy: actor.sub })
    return updated
  })
}
