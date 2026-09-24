/**
 * Supplier Payment: belongs to one deal (spec: every document belongs to
 * one deal) and posts and is saved APPROVED in the same step — there is no
 * separate draft/approve lifecycle any more (Task 7): the person who
 * records a payment is trusted with the arithmetic the way a system
 * journal already is, and a mistake is corrected with a reversal, not a
 * second approver (supplierPayment.posting.ts's reverseSupplierPayment).
 */

import { Prisma } from "../../generated/prisma/client"
import type { Prisma as PrismaNamespace } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import { resolveRateOrThrow } from "../payroll/payroll.fx"
import type { AccessTokenPayload } from "../auth/auth.types"
import { postSystemJournal } from "../accounting/accounting.posting"
import { toLedgerDate } from "../accounting/accounting.utils"
import { loadRules } from "../posting/posting.rules"
import { assertDealAccess } from "../receivables/receivables.access"
import { assertAllocatable } from "./supplierBill.allocation"
import { buildSupplierPaymentLines } from "./supplierPayment.posting"
import type { CreateSupplierPaymentInput } from "./supplierPayment.validators"

export async function listSupplierPayments() {
  return prisma.supplierPayment.findMany({
    include: { allocations: true },
    orderBy: { date: "desc" },
  })
}

export async function getSupplierPayment(id: string) {
  const payment = await prisma.supplierPayment.findUnique({
    where: { id },
    include: { allocations: true },
  })
  if (!payment) throw new AppError(404, "Supplier payment not found")
  return payment
}

/**
 * Each allocation's taka figure is what it clears from 2111. For a taka
 * payment that is the amount typed. For a USD payment it is the USD
 * principal at the bill's own frozen rate, the figure the bill put into
 * 2111; the gap to what the bank paid is the exchange difference, posted
 * alongside it (supplierPayment.posting.ts).
 */
async function toStoredAllocations(
  tx: PrismaNamespace.TransactionClient,
  deal: { id: string },
  input: CreateSupplierPaymentInput
) {
  const billIds = [...new Set(input.allocations.map((a) => a.billId))]
  const bills = await tx.supplierBill.findMany({
    where: { id: { in: billIds } },
    select: { id: true, billNumber: true, opportunityId: true, currency: true, fxRateToBdt: true },
  })
  const byId = new Map(bills.map((b) => [b.id, b]))

  return input.allocations.map((a) => {
    const bill = byId.get(a.billId)
    if (!bill) throw new AppError(404, "A bill being paid does not exist")
    // Review Focus 1 (supplier side): two bills can share a supplier while
    // belonging to different deals. A payment settles one deal, so a bill
    // from any other deal is refused even when the supplier matches.
    if (bill.opportunityId !== deal.id) {
      throw new AppError(400, `Bill ${bill.billNumber} is on a different deal. Record a separate payment on that deal.`)
    }
    if (input.currency === "BDT") {
      return { billId: a.billId, amount: new Prisma.Decimal(a.amount).toFixed(2), amountUsd: null }
    }
    if (bill.currency !== "USD" || !bill.fxRateToBdt) {
      throw new AppError(400, `A payment in US dollars can only pay a bill in US dollars. Bill ${bill.billNumber} is in taka.`)
    }
    return { billId: a.billId, amount: new Prisma.Decimal(a.amount).times(bill.fxRateToBdt).toFixed(2), amountUsd: a.amount }
  })
}

export async function createSupplierPayment(input: CreateSupplierPaymentInput, actor: AccessTokenPayload) {
  // Exactly, not "at most": a payment with money left over is an advance
  // (removed, Task 4) and a payment allocated past what it settles cannot
  // exist either.
  const settled = new Prisma.Decimal(input.amount)
  const allocatedTotal = input.allocations.reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0))
  if (settled.greaterThan(allocatedTotal)) {
    throw new AppError(
      400,
      `This payment is ${settled.minus(allocatedTotal).toFixed(2)} more than the bills it pays. Money paid before a bill cannot be recorded. Add the bill first.`
    )
  }
  if (allocatedTotal.greaterThan(settled)) {
    throw new AppError(400, "The bills you picked add up to more than this payment. Lower an amount.")
  }

  return prisma.$transaction(async (tx: PrismaNamespace.TransactionClient) => {
    const deal = await assertDealAccess(tx, actor, input.opportunityId)

    const rate =
      input.currency === "BDT"
        ? null
        : new Prisma.Decimal((await resolveRateOrThrow("USD", new Date(input.date))).toString())

    const allocations = await toStoredAllocations(tx, deal, input)

    // Re-checked here, not only above: this is the outstanding-balance and
    // supplier-match check, re-run inside the transaction since another
    // payment could have landed on the same bill between the check above
    // and this write.
    await assertAllocatable(tx, input.supplierId, allocations)

    const now = new Date()
    const payment = await tx.supplierPayment.create({
      data: {
        supplierId: input.supplierId,
        opportunityId: deal.id,
        date: new Date(input.date),
        amount: rate ? settled.times(rate).toFixed(2) : settled.toFixed(2),
        sourceAmount: rate ? input.amount : null,
        currency: input.currency,
        fxRateToBdt: rate ? rate.toFixed(6) : null,
        reference: input.reference ?? null,
        status: "APPROVED",
        approvedBy: actor.sub,
        approvedAt: now,
        createdBy: actor.sub,
        allocations: { create: allocations },
      },
      include: { allocations: true, supplier: { select: { name: true } } },
    })

    const [rules, fxRules] = await Promise.all([loadRules(tx, "SUPPLIER_PAYMENT"), loadRules(tx, "FX")])
    await postSystemJournal(tx, {
      date: toLedgerDate(payment.date),
      narration: `Payment — ${payment.supplier.name}`,
      source: { module: "SUPPLIER", refId: payment.id, event: "PAYMENT" },
      lines: buildSupplierPaymentLines({ ...payment, opportunityId: deal.id }, rules, fxRules),
      createdBy: actor.sub,
    })

    await writeAudit(tx, {
      entity: "SUPPLIER_PAYMENT",
      entityId: payment.id,
      action: "CREATE",
      changedBy: actor.sub,
      after: { supplierId: payment.supplierId, amount: payment.amount, opportunityId: deal.id },
    })

    return payment
  })
}
