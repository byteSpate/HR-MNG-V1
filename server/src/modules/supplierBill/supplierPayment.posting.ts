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
  lines.push({ accountCode: resolveAccountCode(rules, "BANK"), credit: payment.amount.toFixed(2) })

  return lines
}

async function loadPaymentForPosting(tx: PrismaNamespace.TransactionClient, id: string): Promise<PaymentForPosting> {
  return tx.supplierPayment.findUniqueOrThrow({
    where: { id },
    select: {
      id: true, supplierId: true, amount: true, sourceAmount: true, currency: true, fxRateToBdt: true,
      allocations: { select: { billId: true, amount: true, amountUsd: true } },
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
    include: { allocations: true },
  })
  if (!payment) throw new AppError(404, "Supplier payment not found")
  if (payment.status !== "DRAFT") throw new AppError(409, `This payment is already ${payment.status.toLowerCase()}`)
  if (payment.createdBy === actor.sub) throw new AppError(403, "You prepared this payment and cannot also approve it")

  return prisma.$transaction(async (tx) => {
    // Re-checked here, not only at draft time: another payment against the
    // same bill may have been approved in between.
    await assertAllocatable(
      tx,
      payment.supplierId,
      payment.allocations.map((a) => ({ billId: a.billId, amount: a.amount.toString() }))
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
