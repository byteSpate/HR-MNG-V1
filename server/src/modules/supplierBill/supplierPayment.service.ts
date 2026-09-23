/**
 * Supplier Payment: DRAFT while Finance drafts it, APPROVED once Super Admin
 * signs off, approval is what posts (supplierPayment.posting.ts).
 *
 * An allocation chosen at creation time settles a specific bill; an amount
 * left unallocated becomes an advance. Both are the same record, design
 * §3.1 never distinguishes "a payment" from "an advance" as different
 * documents, only as different allocation states of one.
 */

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

export async function createSupplierPayment(input: CreateSupplierPaymentInput, actor: AccessTokenPayload) {
  const allocatedTotal = input.allocations.reduce((sum, a) => sum + Number(a.amount), 0)
  if (allocatedTotal > Number(input.amount)) {
    throw new AppError(400, "Allocations cannot add up to more than the payment amount")
  }

  return prisma.$transaction(async (tx) => {
    await assertAllocatable(tx, input.supplierId, input.allocations)

    const fxRateToBdt =
      input.currency === "BDT" ? null : (await resolveRateOrThrow("USD", new Date(input.date))).toFixed(6)

    const payment = await tx.supplierPayment.create({
      data: {
        supplierId: input.supplierId,
        date: new Date(input.date),
        amount: input.amount,
        sourceAmount: input.currency === "BDT" ? null : (input.sourceAmount ?? input.amount),
        currency: input.currency,
        fxRateToBdt,
        reference: input.reference ?? null,
        status: "DRAFT",
        createdBy: actor.sub,
        allocations: {
          create: input.allocations.map((a) => ({ billId: a.billId, amount: a.amount })),
        },
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
