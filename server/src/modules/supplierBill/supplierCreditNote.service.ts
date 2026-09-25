/**
 * Supplier Credit Note: always against an already-APPROVED bill (a draft
 * bill has nothing posted yet to reverse). DRAFT while Finance prepares it,
 * APPROVED once Super Admin signs off, approval posts (supplierCreditNote.posting.ts).
 */

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import type { CreateSupplierCreditNoteInput } from "./supplierCreditNote.validators"

export async function listSupplierCreditNotes() {
  return prisma.supplierCreditNote.findMany({
    include: { lines: true },
    orderBy: { date: "desc" },
  })
}

export async function getSupplierCreditNote(id: string) {
  const note = await prisma.supplierCreditNote.findUnique({ where: { id }, include: { lines: true } })
  if (!note) throw new AppError(404, "Supplier credit note not found")
  return note
}

export async function createSupplierCreditNote(input: CreateSupplierCreditNoteInput, actor: AccessTokenPayload) {
  const bill = await prisma.supplierBill.findUnique({
    where: { id: input.billId },
    include: { lines: { include: { creditNoteLines: { select: { amount: true, vatAmount: true } } } } },
  })
  if (!bill) throw new AppError(404, "Supplier bill not found")
  if (bill.status !== "APPROVED") throw new AppError(409, "A credit note can only be raised against an approved bill")

  // Every earlier credit note counts, draft or approved: a draft cannot be
  // discarded, so leaving it out would let two drafts credit the same line
  // twice between them.
  const lineById = new Map(bill.lines.map((l) => [l.id, l]))
  for (const line of input.lines) {
    const billLine = lineById.get(line.billLineId)
    if (!billLine) throw new AppError(400, "One of this credit note's lines is not a line on this bill.")

    const credited = billLine.creditNoteLines.reduce((s, c) => s.plus(c.amount), new Prisma.Decimal(0))
    const creditedVat = billLine.creditNoteLines.reduce((s, c) => s.plus(c.vatAmount), new Prisma.Decimal(0))
    const left = new Prisma.Decimal(billLine.amount).minus(credited)
    const leftVat = new Prisma.Decimal(billLine.vatAmount).minus(creditedVat)

    if (new Prisma.Decimal(line.amount).greaterThan(left)) {
      throw new AppError(400, `Only ${left.toFixed(2)} is left to credit on ${billLine.description}`)
    }
    if (new Prisma.Decimal(line.vatAmount).greaterThan(leftVat)) {
      throw new AppError(400, `Only ${leftVat.toFixed(2)} of VAT is left to credit on ${billLine.description}`)
    }
  }

  return prisma.$transaction(async (tx) => {
    const note = await tx.supplierCreditNote.create({
      data: {
        billId: input.billId,
        supplierId: bill.supplierId,
        date: new Date(input.date),
        reason: input.reason,
        status: "DRAFT",
        createdBy: actor.sub,
        lines: { create: input.lines },
      },
      include: { lines: true },
    })

    await writeAudit(tx, {
      entity: "SUPPLIER_CREDIT_NOTE",
      entityId: note.id,
      action: "CREATE",
      changedBy: actor.sub,
      after: { billId: input.billId, reason: input.reason },
    })

    return note
  })
}
