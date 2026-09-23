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
import { assertOpeningReceivable, assertReceivable } from "./receipt.allocation"
import { receiptPosition } from "./receipt.service"
import type { MatchCustomerAdvanceInput } from "./receipt.validators"

type Line = SystemJournalInput["lines"][number]

export interface ReceiptForPosting {
  id: string
  customerId: string
  amount: Prisma.Decimal
  vdsAmount: Prisma.Decimal
  aitAmount: Prisma.Decimal
  allocations: Array<{ amount: Prisma.Decimal; matchedAt: Date | null }>
  openingAllocations: Array<{ amount: Prisma.Decimal; matchedAt: Date | null }>
}

/** Dr Bank for the cash, Dr VDS/AIT for what the customer kept, Cr
 *  Receivable for what upfront allocations cleared (invoices and the
 *  opening balance together), Cr Advance for whatever is left over. An
 *  allocation matched later (matchCustomerAdvance) posts its own reclass,
 *  once, so it is left out here. */
export function buildReceiptLines(receipt: ReceiptForPosting, rules: ResolvedRules): Line[] {
  const upfront = [...receipt.allocations, ...receipt.openingAllocations].filter((a) => a.matchedAt === null)
  const cleared = upfront.reduce((s, a) => s.plus(a.amount), new Prisma.Decimal(0))
  const { advance } = receiptPosition({ ...receipt, allocations: upfront, openingAllocations: [] })

  const lines: Line[] = [{ accountCode: resolveAccountCode(rules, "BANK"), debit: receipt.amount.toFixed(2) }]
  if (!receipt.vdsAmount.isZero()) {
    lines.push({ accountCode: resolveAccountCode(rules, "VDS"), debit: receipt.vdsAmount.toFixed(2), customerId: receipt.customerId })
  }
  if (!receipt.aitAmount.isZero()) {
    lines.push({ accountCode: resolveAccountCode(rules, "AIT"), debit: receipt.aitAmount.toFixed(2), customerId: receipt.customerId })
  }
  if (!cleared.isZero()) {
    lines.push({ accountCode: resolveAccountCode(rules, "RECEIVABLE"), credit: cleared.toFixed(2), customerId: receipt.customerId })
  }
  if (!advance.isZero()) {
    lines.push({ accountCode: resolveAccountCode(rules, "ADVANCE"), credit: advance.toFixed(2), customerId: receipt.customerId })
  }
  return lines
}

export async function approveReceipt(id: string, actor: AccessTokenPayload) {
  const receipt = await prisma.receipt.findUnique({
    where: { id },
    include: { allocations: true, openingAllocations: true, customer: { select: { legalName: true } } },
  })
  if (!receipt) throw new AppError(404, "Receipt not found")
  if (receipt.status !== "DRAFT") throw new AppError(409, `This receipt is already ${receipt.status.toLowerCase()}`)
  if (receipt.createdBy === actor.sub) throw new AppError(403, "You prepared this receipt and cannot also approve it")

  return prisma.$transaction(async (tx) => {
    // Re-checked here, not only at draft time: another receipt against the
    // same invoice (or the same opening balance) may have been approved
    // in between.
    await assertReceivable(
      tx, receipt.customerId,
      receipt.allocations.filter((a) => a.matchedAt === null).map((a) => ({ invoiceId: a.invoiceId, amount: a.amount }))
    )
    for (const oa of receipt.openingAllocations.filter((a) => a.matchedAt === null)) {
      await assertOpeningReceivable(tx, receipt.customerId, oa.amount)
    }

    const updated = await tx.receipt.update({
      where: { id },
      data: { status: "APPROVED", approvedBy: actor.sub, approvedAt: new Date() },
      include: { allocations: true, openingAllocations: true, customer: { select: { legalName: true } } },
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

/**
 * An advance (a receipt with unallocated balance) matched to an invoice or
 * the opening balance that arrives later. Posts design §3.3's "Advance
 * matched" reclass: Dr 2160, Cr 1220, for exactly the amount matched now.
 */
export async function matchCustomerAdvance(receiptId: string, input: MatchCustomerAdvanceInput, actor: AccessTokenPayload) {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: { allocations: true, openingAllocations: true },
  })
  if (!receipt) throw new AppError(404, "Receipt not found")
  if (receipt.status !== "APPROVED") throw new AppError(400, "Only an approved receipt's advance can be matched")

  const { advance } = receiptPosition(receipt)
  const amount = new Prisma.Decimal(input.amount)
  if (amount.greaterThan(advance)) {
    throw new AppError(400, `Only ${advance.toFixed(2)} of this advance is left to match`)
  }

  return prisma.$transaction(async (tx) => {
    const rules = await loadRules(tx, "RECEIPT")

    if (input.invoiceId) {
      await assertReceivable(tx, receipt.customerId, [{ invoiceId: input.invoiceId, amount }])
      await tx.receiptAllocation.create({
        data: { receiptId, invoiceId: input.invoiceId, amount: amount.toFixed(2), matchedAt: new Date() },
      })
      const result = await postSystemJournal(tx, {
        date: toLedgerDate(new Date()),
        narration: "Advance matched — invoice",
        source: { module: "CUSTOMER", refId: `${receiptId}:${input.invoiceId}`, event: "ADVANCE_MATCH" },
        lines: [
          { accountCode: resolveAccountCode(rules, "ADVANCE"), debit: amount.toFixed(2), customerId: receipt.customerId },
          { accountCode: resolveAccountCode(rules, "RECEIVABLE"), credit: amount.toFixed(2), customerId: receipt.customerId },
        ],
        createdBy: actor.sub,
      })
      await writeAudit(tx, {
        entity: "RECEIPT", entityId: receiptId, action: "UPDATE", changedBy: actor.sub,
        after: { matchedInvoiceId: input.invoiceId, amount: amount.toFixed(2) }, note: "Advance matched",
      })
      return result
    }

    const { openingBalanceId } = await assertOpeningReceivable(tx, receipt.customerId, amount)
    await tx.receiptOpeningAllocation.create({
      data: { receiptId, openingBalanceId, amount: amount.toFixed(2), matchedAt: new Date() },
    })
    const result = await postSystemJournal(tx, {
      date: toLedgerDate(new Date()),
      narration: "Advance matched — opening balance",
      source: { module: "CUSTOMER", refId: `${receiptId}:ob:${openingBalanceId}`, event: "ADVANCE_MATCH" },
      lines: [
        { accountCode: resolveAccountCode(rules, "ADVANCE"), debit: amount.toFixed(2), customerId: receipt.customerId },
        { accountCode: resolveAccountCode(rules, "RECEIVABLE"), credit: amount.toFixed(2), customerId: receipt.customerId },
      ],
      createdBy: actor.sub,
    })
    await writeAudit(tx, {
      entity: "RECEIPT", entityId: receiptId, action: "UPDATE", changedBy: actor.sub,
      after: { matchedOpeningBalanceId: openingBalanceId, amount: amount.toFixed(2) }, note: "Advance matched",
    })
    return result
  })
}
