import { Prisma } from "../../generated/prisma/client"
import type { Prisma as PrismaNamespace } from "../../generated/prisma/client"
import type { SystemJournalInput } from "../accounting/accounting.types"
import { postReversalNow } from "../accounting/accounting.reversal"
import { resolveAccountCode } from "../posting/posting.rules"
import type { ResolvedRules } from "../posting/posting.types"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"

type Line = SystemJournalInput["lines"][number]

interface AllocationForPosting {
  billId: string
  /** BDT this allocation clears from 2111: for a USD bill, its USD
   *  principal at the bill's own frozen rate, the figure 2111 was credited
   *  with when the bill was approved. */
  amount: Prisma.Decimal
  amountUsd: Prisma.Decimal | null
}

interface PaymentForPosting {
  id: string
  supplierId: string
  // The one deal this payment belongs to (Task 7). Every posted line
  // carries it, the same rule the receipt already follows.
  opportunityId: string
  /** BDT that left the bank. For a USD payment, sourceAmount x fxRateToBdt. */
  amount: Prisma.Decimal
  sourceAmount: Prisma.Decimal | null
  currency: "BDT" | "USD"
  fxRateToBdt: Prisma.Decimal | null
  allocations: AllocationForPosting[]
}

const ZERO = new Prisma.Decimal(0)

/**
 * design §3.1: Dr 2111 for what the bills recorded, Cr bank for what
 * actually left it. On a USD payment the bills were recorded at their own
 * rates and the bank paid at today's, and that gap is design §3.1's
 * "Payment at a different rate", booked as an exchange gain or loss.
 *
 * The exchange difference is taken as the balancing figure, bank - cleared,
 * rather than summed line by line: per-line rounding would otherwise leave
 * a paisa the journal refuses. Every payment fully allocates to a bill (no
 * advances), so on a taka payment cleared always equals the bank figure and
 * there is no exchange line.
 */
export function buildSupplierPaymentLines(
  payment: PaymentForPosting,
  rules: ResolvedRules,
  fxRules: ResolvedRules
): Line[] {
  const cleared = payment.allocations.reduce((sum, a) => sum.plus(a.amount), ZERO)

  let exchange = ZERO
  if (payment.currency === "USD" && payment.fxRateToBdt && payment.sourceAmount) {
    exchange = payment.amount.minus(cleared)
  }

  const dims = { supplierId: payment.supplierId, opportunityId: payment.opportunityId }
  const lines: Line[] = []
  if (!cleared.isZero()) {
    lines.push({ accountCode: resolveAccountCode(rules, "PAYABLE"), debit: cleared.toFixed(2), ...dims })
  }
  if (exchange.greaterThan(0)) {
    lines.push({ accountCode: resolveAccountCode(fxRules, "LOSS"), debit: exchange.toFixed(2), ...dims })
  } else if (exchange.lessThan(0)) {
    lines.push({ accountCode: resolveAccountCode(fxRules, "GAIN"), credit: exchange.abs().toFixed(2), ...dims })
  }
  lines.push({ accountCode: resolveAccountCode(rules, "BANK"), credit: payment.amount.toFixed(2), opportunityId: payment.opportunityId })

  return lines
}

const REVERSE_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  allocations: { include: { bill: { select: { id: true, billNumber: true } } } },
} satisfies Prisma.SupplierPaymentInclude

/**
 * Super Admin only (spec: a supplier payment no longer has a separate
 * approval step, so the only correction path left is a reversal). The
 * payment's journal is found by the same source triple `postSystemJournal`
 * used to post it — a payment carries no `journalId` column of its own.
 */
export async function reverseSupplierPayment(id: string, input: { reason: string }, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx: PrismaNamespace.TransactionClient) => {
    const payment = await tx.supplierPayment.findUnique({ where: { id } })
    if (!payment) throw new AppError(404, "Supplier payment not found")
    if (payment.status !== "APPROVED") {
      throw new AppError(409, `This payment is ${payment.status.toLowerCase()}, so it cannot be reversed`)
    }

    const journal = await tx.journal.findFirst({
      where: { sourceModule: "SUPPLIER", sourceRefId: id, sourceEvent: "PAYMENT" },
      select: { id: true },
    })
    if (!journal) throw new AppError(409, "No posted journal was found for this payment")

    const reversal = await postReversalNow(tx, journal.id, input.reason, actor.sub)

    const updated = await tx.supplierPayment.update({
      where: { id },
      data: { status: "REVERSED", reversedBy: actor.sub, reversedAt: new Date(), reversalReason: input.reason },
      include: REVERSE_INCLUDE,
    })

    await writeAudit(tx, {
      entity: "SUPPLIER_PAYMENT", entityId: id, action: "REVERSE", changedBy: actor.sub,
      before: { status: "APPROVED" }, after: { status: "REVERSED", reversedBy: reversal.journalNo },
      note: input.reason,
    })

    return updated
  })
}
