import { Prisma } from "../../generated/prisma/client"
import type { Prisma as PrismaNamespace } from "../../generated/prisma/client"
import type { SystemJournalInput } from "../accounting/accounting.types"
import { postSystemJournal } from "../accounting/accounting.posting"
import { toLedgerDate } from "../accounting/accounting.utils"
import { loadRules, resolveAccountCode } from "../posting/posting.rules"
import type { ResolvedRules } from "../posting/posting.types"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import { assertAllocatable, assertOpeningPayable } from "./supplierBill.allocation"
import type { MatchAdvanceInput } from "./supplierPayment.validators"

type Line = SystemJournalInput["lines"][number]

interface AllocationForPosting {
  billId: string
  /** BDT this allocation clears from 2111: for a USD bill, its USD
   *  principal at the bill's own frozen rate, the figure 2111 was credited
   *  with when the bill was approved. */
  amount: Prisma.Decimal
  amountUsd: Prisma.Decimal | null
  matchedAt: Date | null
}

interface OpeningAllocationForPosting {
  amount: Prisma.Decimal
  matchedAt: Date | null
}

interface PaymentForPosting {
  id: string
  supplierId: string
  /** BDT that left the bank. For a USD payment, sourceAmount x fxRateToBdt. */
  amount: Prisma.Decimal
  sourceAmount: Prisma.Decimal | null
  currency: "BDT" | "USD"
  fxRateToBdt: Prisma.Decimal | null
  allocations: AllocationForPosting[]
  openingAllocations: OpeningAllocationForPosting[]
}

const ZERO = new Prisma.Decimal(0)

/**
 * design §3.1: Dr 2111 for what the bills recorded, Dr 1232 for what is
 * left as an advance, Cr bank for what actually left it. On a USD payment
 * the bills were recorded at their own rates and the bank paid at today's,
 * and that gap is design §3.1's "Payment at a different rate".
 *
 * The exchange difference is taken as the balancing figure,
 * bank - cleared - advance, rather than summed line by line: per-line
 * rounding would otherwise leave a paisa the journal refuses.
 */
export function buildSupplierPaymentLines(
  payment: PaymentForPosting,
  rules: ResolvedRules,
  fxRules: ResolvedRules
): Line[] {
  // Only allocations chosen at draft time belong to this journal. One
  // matched later (matchAdvance) posts its own reclass, once. The opening
  // balance clears the same way a bill does, so it is counted alongside it
  // rather than sitting in 1232 as an advance.
  const upfront = payment.allocations.filter((a) => a.matchedAt === null)
  const upfrontOpening = payment.openingAllocations.filter((a) => a.matchedAt === null)
  const cleared = [...upfront, ...upfrontOpening].reduce((sum, a) => sum.plus(a.amount), ZERO)

  let advance: Prisma.Decimal
  let exchange = ZERO
  if (payment.currency === "USD" && payment.fxRateToBdt && payment.sourceAmount) {
    const allocatedUsd = upfront.reduce((sum, a) => sum.plus(a.amountUsd ?? ZERO), ZERO)
    advance = new Prisma.Decimal(payment.sourceAmount.minus(allocatedUsd).times(payment.fxRateToBdt).toFixed(2))
    exchange = payment.amount.minus(cleared).minus(advance)
  } else {
    advance = payment.amount.minus(cleared)
  }

  const dims = { supplierId: payment.supplierId }
  const lines: Line[] = []
  if (!cleared.isZero()) {
    lines.push({ accountCode: resolveAccountCode(rules, "PAYABLE"), debit: cleared.toFixed(2), ...dims })
  }
  if (exchange.greaterThan(0)) {
    lines.push({ accountCode: resolveAccountCode(fxRules, "LOSS"), debit: exchange.toFixed(2), ...dims })
  } else if (exchange.lessThan(0)) {
    lines.push({ accountCode: resolveAccountCode(fxRules, "GAIN"), credit: exchange.abs().toFixed(2), ...dims })
  }
  if (!advance.isZero()) {
    lines.push({ accountCode: resolveAccountCode(rules, "ADVANCE"), debit: advance.toFixed(2), ...dims })
  }
  lines.push({ accountCode: resolveAccountCode(rules, "BANK"), credit: payment.amount.toFixed(2) })

  return lines
}

async function loadPaymentForPosting(tx: PrismaNamespace.TransactionClient, id: string): Promise<PaymentForPosting> {
  return tx.supplierPayment.findUniqueOrThrow({
    where: { id },
    select: {
      id: true, supplierId: true, amount: true, sourceAmount: true, currency: true, fxRateToBdt: true,
      allocations: { select: { billId: true, amount: true, amountUsd: true, matchedAt: true } },
      openingAllocations: { select: { amount: true, matchedAt: true } },
    },
  })
}

export async function postSupplierPayment(tx: PrismaNamespace.TransactionClient, paymentId: string, actorUserId: string) {
  const payment = await loadPaymentForPosting(tx, paymentId)
  const [rules, fxRules] = await Promise.all([loadRules(tx, "SUPPLIER_PAYMENT"), loadRules(tx, "FX")])
  const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: payment.supplierId }, select: { name: true } })

  return postSystemJournal(tx, {
    date: toLedgerDate(new Date()),
    narration: `Payment — ${supplier.name}`,
    source: { module: "SUPPLIER", refId: paymentId, event: "PAYMENT" },
    lines: buildSupplierPaymentLines(payment, rules, fxRules),
    createdBy: actorUserId,
  })
}

export async function approveSupplierPayment(id: string, actor: AccessTokenPayload) {
  const payment = await prisma.supplierPayment.findUnique({
    where: { id },
    include: { allocations: true, openingAllocations: true },
  })
  if (!payment) throw new AppError(404, "Supplier payment not found")
  if (payment.status !== "DRAFT") throw new AppError(409, `This payment is already ${payment.status.toLowerCase()}`)
  if (payment.createdBy === actor.sub) throw new AppError(403, "You prepared this payment and cannot also approve it")

  return prisma.$transaction(async (tx) => {
    // Re-checked here, not only at draft time: another payment against the
    // same bill (or the same opening balance) may have been approved in
    // between.
    await assertAllocatable(
      tx,
      payment.supplierId,
      payment.allocations.filter((a) => a.matchedAt === null).map((a) => ({ billId: a.billId, amount: a.amount.toString() }))
    )
    for (const oa of (payment.openingAllocations ?? []).filter((a) => a.matchedAt === null)) {
      await assertOpeningPayable(tx, payment.supplierId, oa.amount)
    }

    const updated = await tx.supplierPayment.update({
      where: { id },
      data: { status: "APPROVED", approvedBy: actor.sub, approvedAt: new Date() },
      include: { allocations: true, openingAllocations: true },
    })
    await postSupplierPayment(tx, id, actor.sub)
    await writeAudit(tx, { entity: "SUPPLIER_PAYMENT", entityId: id, action: "APPROVE", changedBy: actor.sub })
    return updated
  })
}

/**
 * An advance (a payment with unallocated balance) is matched to a bill that
 * arrives later. Posts design §3.1's "Advance matched" reclass: Dr 2111,
 * Cr 1232, for exactly the amount matched now, never the whole payment.
 */
export async function matchAdvance(paymentId: string, input: MatchAdvanceInput, actor: AccessTokenPayload) {
  const payment = await prisma.supplierPayment.findUnique({
    where: { id: paymentId },
    include: { allocations: true, openingAllocations: true },
  })
  if (!payment) throw new AppError(404, "Supplier payment not found")
  if (payment.status !== "APPROVED") throw new AppError(409, "Only an approved payment carries a matchable advance")
  // A USD advance sits in 1232 at the payment's rate and the bill in 2111 at
  // the bill's; matching them needs an exchange difference this reclass does
  // not work out. Refused rather than posted wrong.
  if (payment.currency === "USD") {
    throw new AppError(
      409,
      "A USD advance cannot be matched here yet. Record the match as a manual journal, with the exchange difference."
    )
  }

  const allocated = [...payment.allocations, ...(payment.openingAllocations ?? [])].reduce(
    (sum, a) => sum.plus(a.amount),
    new Prisma.Decimal(0)
  )
  const available = payment.amount.minus(allocated)
  if (new Prisma.Decimal(input.amount).greaterThan(available)) {
    throw new AppError(400, `Only ${available.toFixed(2)} is still unmatched on this payment`)
  }

  return prisma.$transaction(async (tx) => {
    if (input.billId) {
      await assertAllocatable(tx, payment.supplierId, [{ billId: input.billId, amount: input.amount }])

      await tx.supplierPaymentAllocation.create({
        data: { paymentId, billId: input.billId, amount: input.amount, matchedAt: new Date() },
      })

      const [rules, bill] = await Promise.all([
        loadRules(tx, "SUPPLIER_PAYMENT"),
        tx.supplierBill.findUniqueOrThrow({ where: { id: input.billId }, select: { billNumber: true } }),
      ])

      const result = await postSystemJournal(tx, {
        date: toLedgerDate(new Date()),
        narration: `Advance matched — bill ${bill.billNumber}`,
        source: { module: "SUPPLIER", refId: `${paymentId}:${input.billId}`, event: "ADVANCE_MATCH" },
        lines: [
          { accountCode: resolveAccountCode(rules, "PAYABLE"), debit: input.amount, supplierId: payment.supplierId },
          { accountCode: resolveAccountCode(rules, "ADVANCE"), credit: input.amount, supplierId: payment.supplierId },
        ],
        createdBy: actor.sub,
      })

      await writeAudit(tx, {
        entity: "SUPPLIER_PAYMENT",
        entityId: paymentId,
        action: "UPDATE",
        changedBy: actor.sub,
        after: { matchedBillId: input.billId, amount: input.amount },
      })

      return result
    }

    // Otherwise the opening balance (input.openingBalanceId): matchAdvanceSchema's
    // refine guarantees exactly one of the two is set.
    const { openingBalanceId } = await assertOpeningPayable(tx, payment.supplierId, new Prisma.Decimal(input.amount))

    await tx.supplierOpeningAllocation.create({
      data: { paymentId, openingBalanceId, amount: input.amount, matchedAt: new Date() },
    })

    const rules = await loadRules(tx, "SUPPLIER_PAYMENT")

    const result = await postSystemJournal(tx, {
      date: toLedgerDate(new Date()),
      narration: "Advance matched — opening balance",
      source: { module: "SUPPLIER", refId: `${paymentId}:ob:${openingBalanceId}`, event: "ADVANCE_MATCH" },
      lines: [
        { accountCode: resolveAccountCode(rules, "PAYABLE"), debit: input.amount, supplierId: payment.supplierId },
        { accountCode: resolveAccountCode(rules, "ADVANCE"), credit: input.amount, supplierId: payment.supplierId },
      ],
      createdBy: actor.sub,
    })

    await writeAudit(tx, {
      entity: "SUPPLIER_PAYMENT",
      entityId: paymentId,
      action: "UPDATE",
      changedBy: actor.sub,
      after: { matchedOpeningBalanceId: openingBalanceId, amount: input.amount },
    })

    return result
  })
}
