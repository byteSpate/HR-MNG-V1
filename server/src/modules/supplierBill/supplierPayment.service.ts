/**
 * Supplier Payment: DRAFT while Finance drafts it, APPROVED once Super Admin
 * signs off, approval is what posts (supplierPayment.posting.ts).
 */

import { Prisma } from "../../generated/prisma/client"
import type { Prisma as PrismaNamespace } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import { resolveRateOrThrow } from "../payroll/payroll.fx"
import type { AccessTokenPayload } from "../auth/auth.types"
import { assertAllocatable } from "./supplierBill.allocation"
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
 * 2111; the gap to what the bank paid is the exchange difference, posted on
 * approval (supplierPayment.posting.ts).
 */
async function toStoredAllocations(tx: PrismaNamespace.TransactionClient, input: CreateSupplierPaymentInput) {
  if (input.currency === "BDT") {
    return input.allocations.map((a) => ({
      billId: a.billId,
      amount: new Prisma.Decimal(a.amount).toFixed(2),
      amountUsd: null,
    }))
  }

  const bills = await tx.supplierBill.findMany({
    where: { id: { in: input.allocations.map((a) => a.billId) } },
    select: { id: true, billNumber: true, currency: true, fxRateToBdt: true },
  })
  const byId = new Map(bills.map((b) => [b.id, b]))

  return input.allocations.map((a) => {
    const bill = byId.get(a.billId)
    if (!bill) throw new AppError(404, "A bill being paid does not exist")
    if (bill.currency !== "USD" || !bill.fxRateToBdt) {
      throw new AppError(400, `A USD payment can only settle a USD bill. Bill ${bill.billNumber} is in taka.`)
    }
    return {
      billId: a.billId,
      amount: new Prisma.Decimal(a.amount).times(bill.fxRateToBdt).toFixed(2),
      amountUsd: a.amount,
    }
  })
}

export async function createSupplierPayment(input: CreateSupplierPaymentInput, actor: AccessTokenPayload) {
  const allocatedTotal = input.allocations.reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0))
  if (allocatedTotal.greaterThan(input.amount)) {
    throw new AppError(400, "Allocations cannot add up to more than the payment amount")
  }
  if (input.allocations.length === 0) {
    throw new AppError(400, "A payment must be allocated to at least one bill")
  }

  return prisma.$transaction(async (tx) => {
    const rate =
      input.currency === "BDT"
        ? null
        : new Prisma.Decimal((await resolveRateOrThrow("USD", new Date(input.date))).toString())

    const allocations = await toStoredAllocations(tx, input)
    await assertAllocatable(tx, input.supplierId, allocations)

    // The deal this payment belongs to, from the bill it pays (Task 7 gives
    // the caller an opportunityId directly; until then, the first
    // allocation's bill names it, same as the migration's backfill).
    const bill = await tx.supplierBill.findUnique({
      where: { id: input.allocations[0].billId },
      select: { opportunityId: true },
    })
    if (!bill) throw new AppError(404, "A bill being paid does not exist")

    const payment = await tx.supplierPayment.create({
      data: {
        supplierId: input.supplierId,
        opportunityId: bill.opportunityId,
        date: new Date(input.date),
        amount: rate ? new Prisma.Decimal(input.amount).times(rate).toFixed(2) : new Prisma.Decimal(input.amount).toFixed(2),
        sourceAmount: rate ? input.amount : null,
        currency: input.currency,
        fxRateToBdt: rate ? rate.toFixed(6) : null,
        reference: input.reference ?? null,
        status: "DRAFT",
        createdBy: actor.sub,
        allocations: { create: allocations },
      },
      include: { allocations: true },
    })

    await writeAudit(tx, {
      entity: "SUPPLIER_PAYMENT",
      entityId: payment.id,
      action: "CREATE",
      changedBy: actor.sub,
      after: { supplierId: payment.supplierId, amount: input.amount },
    })

    return payment
  })
}
