/**
 * Supplier Bill: DRAFT while Finance is entering it, APPROVED once Super
 * Admin signs off — approval is what posts (supplierBill.posting.ts).
 *
 * Every line's amount is stored in BDT. A USD bill freezes its own rate
 * (resolveRateOrThrow, at the bill date) once, here, and every line's
 * sourceAmount x that rate becomes its amount — never re-derived later.
 */

import { Prisma } from "../../generated/prisma/client"
import type { Prisma as PrismaNamespace } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import { resolveRateOrThrow } from "../payroll/payroll.fx"
import type { AccessTokenPayload } from "../auth/auth.types"
import type { CreateSupplierBillInput, UpdateSupplierBillInput } from "./supplierBill.validators"

// VAT is frozen per line when the line is written, from its VAT code's rate
// at that moment, rounded to the paisa (design §3.2). A later change to the
// code's rate never moves a bill already entered.
async function toLineRows(
  tx: PrismaNamespace.TransactionClient,
  input: CreateSupplierBillInput,
  fxRateToBdt: string | null
) {
  const vatIds = [...new Set(input.lines.map((l) => l.vatCodeId))]
  const codes = await tx.vatCode.findMany({ where: { id: { in: vatIds }, isActive: true } })
  const rateById = new Map(codes.map((c) => [c.id, new Prisma.Decimal(c.ratePercent)]))

  // Goods are bought only after the customer's PO, and a PO exists only on a
  // Won deal (design §2), which is also what account 1214's name promises.
  const oppIds = [...new Set(input.lines.map((l) => l.opportunityId))]
  const opps = await tx.opportunity.findMany({
    where: { id: { in: oppIds } },
    select: { id: true, status: true, serial: true },
  })
  const oppById = new Map(opps.map((o) => [o.id, o]))
  for (const id of oppIds) {
    const opp = oppById.get(id)
    if (!opp) throw new AppError(400, "A bill line names a deal that does not exist")
    if (opp.status !== "WON") throw new AppError(409, `${opp.serial} is not a Won deal, so nothing can be bought for it yet`)
  }

  return input.lines.map((line) => {
    const rate = rateById.get(line.vatCodeId)
    if (!rate) throw new AppError(400, "Unknown or inactive VAT code on a bill line")

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
      vatAmount: new Prisma.Decimal(amount).times(rate).dividedBy(100).toFixed(2),
      opportunityId: line.opportunityId,
    }
  })
}

/** The deals a bill line can be tagged to. Read here rather than through
 *  /api/sales/opportunities, which a Finance Officer without a Sales Hub
 *  role cannot open. Won deals only, the same rule toLineRows enforces. */
export async function listBillableOpportunities() {
  const rows = await prisma.opportunity.findMany({
    where: { status: "WON" },
    select: { id: true, serial: true, name: true, salesAccount: { select: { name: true } } },
    orderBy: { serial: "desc" },
  })
  return rows.map((o) => ({ id: o.id, serial: o.serial, name: o.name, accountName: o.salesAccount.name }))
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
        lines: { create: await toLineRows(tx, input, fxRateToBdt) },
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
        lines: { create: await toLineRows(tx, input, fxRateToBdt) },
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
