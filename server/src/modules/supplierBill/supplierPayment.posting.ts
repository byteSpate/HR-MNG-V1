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
import { assertAllocatable } from "./supplierBill.allocation"
import type { MatchAdvanceInput } from "./supplierPayment.validators"

type Line = SystemJournalInput["lines"][number]

interface AllocationForPosting {
  billId: string
  amount: Prisma.Decimal
  amountUsd: Prisma.Decimal | null
  matchedAt: Date | null
  bill: { fxRateToBdt: Prisma.Decimal | null }
}

interface PaymentForPosting {
  id: string
  supplierId: string
  amount: Prisma.Decimal
  currency: "BDT" | "USD"
  fxRateToBdt: Prisma.Decimal | null
  allocations: AllocationForPosting[]
}

export function buildSupplierPaymentLines(payment: PaymentForPosting, rules: ResolvedRules): Line[] {
  // Only allocations chosen at draft time split PAYABLE/ADVANCE. One
  // matched later (matchAdvance, below) posts its own small reclass
  // journal instead, once, at the moment it is matched, never twice.
  const upfront = payment.allocations.filter((a) => a.matchedAt === null)
  const allocated = upfront.reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0))
  const unallocated = payment.amount.minus(allocated)

  const lines: Line[] = []
  if (!allocated.isZero()) {
    lines.push({ accountCode: resolveAccountCode(rules, "PAYABLE"), debit: allocated.toFixed(2), supplierId: payment.supplierId })
  }
  if (!unallocated.isZero()) {
    lines.push({ accountCode: resolveAccountCode(rules, "ADVANCE"), debit: unallocated.toFixed(2), supplierId: payment.supplierId })
  }
  lines.push({ accountCode: resolveAccountCode(rules, "BANK"), credit: payment.amount.toFixed(2) })

  return lines
}

/** design §3.1 "Payment at a different rate": the gap between what a USD
 *  bill recorded (its own frozen rate) and what was actually paid for the
 *  same USD principal (the payment's frozen rate), on every upfront
 *  allocation against a USD bill. */
export function buildFxVarianceLines(payment: PaymentForPosting, fxRules: ResolvedRules): Line[] {
  if (payment.currency !== "USD" || !payment.fxRateToBdt) return []

  const lines: Line[] = []
  for (const a of payment.allocations.filter((x) => x.matchedAt === null)) {
    if (!a.amountUsd || !a.bill.fxRateToBdt) continue
    const billBdt = a.amountUsd.times(a.bill.fxRateToBdt)
    const paidBdt = a.amountUsd.times(payment.fxRateToBdt)
    const variance = paidBdt.minus(billBdt)
    if (variance.isZero()) continue
    if (variance.greaterThan(0)) {
      lines.push({ accountCode: resolveAccountCode(fxRules, "LOSS"), debit: variance.toFixed(2), supplierId: payment.supplierId })
    } else {
      lines.push({ accountCode: resolveAccountCode(fxRules, "GAIN"), credit: variance.abs().toFixed(2), supplierId: payment.supplierId })
    }
  }
  return lines
}

async function loadPaymentForPosting(tx: PrismaNamespace.TransactionClient, id: string): Promise<PaymentForPosting> {
  return tx.supplierPayment.findUniqueOrThrow({
    where: { id },
    select: {
      id: true, supplierId: true, amount: true, currency: true, fxRateToBdt: true,
      allocations: {
        select: { billId: true, amount: true, amountUsd: true, matchedAt: true, bill: { select: { fxRateToBdt: true } } },
      },
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
    lines: [...buildSupplierPaymentLines(payment, rules), ...buildFxVarianceLines(payment, fxRules)],
    createdBy: actorUserId,
  })
}

export async function approveSupplierPayment(id: string, actor: AccessTokenPayload) {
  const payment = await prisma.supplierPayment.findUnique({ where: { id }, include: { allocations: true } })
  if (!payment) throw new AppError(404, "Supplier payment not found")
  if (payment.status !== "DRAFT") throw new AppError(409, `This payment is already ${payment.status.toLowerCase()}`)
  if (payment.createdBy === actor.sub) throw new AppError(403, "You prepared this payment and cannot also approve it")

  return prisma.$transaction(async (tx) => {
    // Re-checked here, not only at draft time: another payment against the
    // same bill may have been approved in between.
    await assertAllocatable(
      tx,
      payment.supplierId,
      payment.allocations.filter((a) => a.matchedAt === null).map((a) => ({ billId: a.billId, amount: a.amount.toString() }))
    )

    const updated = await tx.supplierPayment.update({
      where: { id },
      data: { status: "APPROVED", approvedBy: actor.sub, approvedAt: new Date() },
      include: { allocations: true },
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
  const payment = await prisma.supplierPayment.findUnique({ where: { id: paymentId }, include: { allocations: true } })
  if (!payment) throw new AppError(404, "Supplier payment not found")
  if (payment.status !== "APPROVED") throw new AppError(409, "Only an approved payment carries a matchable advance")

  const allocated = payment.allocations.reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0))
  const available = payment.amount.minus(allocated)
  if (new Prisma.Decimal(input.amount).greaterThan(available)) {
    throw new AppError(400, `Only ${available.toFixed(2)} is still unmatched on this payment`)
  }

  return prisma.$transaction(async (tx) => {
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
  })
}
