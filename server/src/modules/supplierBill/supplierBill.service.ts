/**
 * Supplier Bill: DRAFT while Finance is entering it, APPROVED once Super
 * Admin signs off — approval is what posts (supplierBill.posting.ts).
 *
 * Every line's amount is stored in BDT. A USD bill freezes its own rate
 * (resolveRateOrThrow, at the bill date) once, here, and every line's
 * sourceAmount x that rate becomes its amount — never re-derived later.
 */

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import { resolveRateOrThrow } from "../payroll/payroll.fx"
import type { AccessTokenPayload } from "../auth/auth.types"
import type { CreateSupplierBillInput, UpdateSupplierBillInput } from "./supplierBill.validators"

async function toLineRows(input: CreateSupplierBillInput, fxRateToBdt: string | null) {
  return input.lines.map((line) => {
    const amount =
      input.currency === "BDT" || !line.sourceAmount
        ? line.amount
        : (Number(line.sourceAmount) * Number(fxRateToBdt)).toFixed(2)
    return {
      description: line.description,
      kind: line.kind,
      amount,
      sourceAmount: input.currency === "BDT" ? null : (line.sourceAmount ?? line.amount),
      vatCodeId: line.vatCodeId,
      // Computed from the VAT code's own rate at write time, in
      // supplierBill.posting.ts's approval step, not here. Stored as 0 on
      // creation and frozen once the VAT code's rate is read at approval.
      vatAmount: "0",
      opportunityId: line.opportunityId,
    }
  })
}

export async function listSupplierBills() {
  return prisma.supplierBill.findMany({
    select: {
      id: true, supplierId: true, billNumber: true, date: true, dueDate: true,
      currency: true, status: true,
      lines: { select: { amount: true, vatAmount: true } },
    },
    orderBy: { date: "desc" },
  })
}

export async function getSupplierBill(id: string) {
  const bill = await prisma.supplierBill.findUnique({
    where: { id },
    include: { lines: true },
  })
  if (!bill) throw new AppError(404, "Supplier bill not found")
  return bill
}

export async function createSupplierBill(input: CreateSupplierBillInput, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    const fxRateToBdt =
      input.currency === "BDT" ? null : (await resolveRateOrThrow("USD", new Date(input.date))).toFixed(6)

    const bill = await tx.supplierBill.create({
      data: {
        supplierId: input.supplierId,
        billNumber: input.billNumber,
        date: new Date(input.date),
        dueDate: new Date(input.dueDate),
        currency: input.currency,
        fxRateToBdt,
        status: "DRAFT",
        createdBy: actor.sub,
        lines: { create: await toLineRows(input, fxRateToBdt) },
      },
      include: { lines: true },
    })

    await writeAudit(tx, {
      entity: "SUPPLIER_BILL",
      entityId: bill.id,
      action: "CREATE",
      changedBy: actor.sub,
      after: { billNumber: bill.billNumber, supplierId: bill.supplierId },
    })

    return bill
  })
}

export async function updateSupplierBill(
  id: string,
  input: UpdateSupplierBillInput,
  actor: AccessTokenPayload
) {
  const existing = await prisma.supplierBill.findUnique({ where: { id } })
  if (!existing) throw new AppError(404, "Supplier bill not found")
  if (existing.status !== "DRAFT") throw new AppError(409, "Only a draft bill can be edited")

  return prisma.$transaction(async (tx) => {
    const fxRateToBdt =
      input.currency === "BDT" ? null : (await resolveRateOrThrow("USD", new Date(input.date))).toFixed(6)

    await tx.supplierBillLine.deleteMany({ where: { billId: id } })
    const bill = await tx.supplierBill.update({
      where: { id },
      data: {
        supplierId: input.supplierId,
        billNumber: input.billNumber,
        date: new Date(input.date),
        dueDate: new Date(input.dueDate),
        currency: input.currency,
        fxRateToBdt,
        lines: { create: await toLineRows(input, fxRateToBdt) },
      },
      include: { lines: true },
    })

    await writeAudit(tx, {
      entity: "SUPPLIER_BILL",
      entityId: id,
      action: "UPDATE",
      changedBy: actor.sub,
      before: { billNumber: existing.billNumber },
      after: { billNumber: bill.billNumber },
    })

    return bill
  })
}
