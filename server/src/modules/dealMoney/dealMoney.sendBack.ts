import { Role } from "../../generated/prisma/client"
import type { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AuditEntity } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"

export type ApprovalKind = "INVOICE" | "SUPPLIER_BILL" | "CUSTOMER_CREDIT_NOTE" | "SUPPLIER_CREDIT_NOTE"

const AUDIT_ENTITY: Record<ApprovalKind, AuditEntity> = {
  INVOICE: "INVOICE",
  SUPPLIER_BILL: "SUPPLIER_BILL",
  CUSTOMER_CREDIT_NOTE: "CUSTOMER_CREDIT_NOTE",
  SUPPLIER_CREDIT_NOTE: "SUPPLIER_CREDIT_NOTE",
}

// Easy-English label for the two messages below. Both credit note kinds
// read as "credit note" — nobody outside this file needs to tell them apart
// by name.
const LABEL: Record<ApprovalKind, string> = {
  INVOICE: "invoice",
  SUPPLIER_BILL: "bill",
  CUSTOMER_CREDIT_NOTE: "credit note",
  SUPPLIER_CREDIT_NOTE: "credit note",
}

const NOT_FOUND: Record<ApprovalKind, string> = {
  INVOICE: "Invoice not found",
  SUPPLIER_BILL: "Supplier bill not found",
  CUSTOMER_CREDIT_NOTE: "Customer credit note not found",
  SUPPLIER_CREDIT_NOTE: "Supplier credit note not found",
}

type Draft = { status: string } | null

function loadDraft(tx: Prisma.TransactionClient, kind: ApprovalKind, id: string): Promise<Draft> {
  switch (kind) {
    case "INVOICE":
      return tx.invoice.findUnique({ where: { id } })
    case "SUPPLIER_BILL":
      return tx.supplierBill.findUnique({ where: { id } })
    case "CUSTOMER_CREDIT_NOTE":
      return tx.customerCreditNote.findUnique({ where: { id } })
    case "SUPPLIER_CREDIT_NOTE":
      return tx.supplierCreditNote.findUnique({ where: { id } })
  }
}

function updateDraft(
  tx: Prisma.TransactionClient,
  kind: ApprovalKind,
  id: string,
  data: { rejectionNote: string; sentBackBy: string; sentBackAt: Date }
) {
  switch (kind) {
    case "INVOICE":
      return tx.invoice.update({ where: { id }, data })
    case "SUPPLIER_BILL":
      return tx.supplierBill.update({ where: { id }, data })
    case "CUSTOMER_CREDIT_NOTE":
      return tx.customerCreditNote.update({ where: { id }, data })
    case "SUPPLIER_CREDIT_NOTE":
      return tx.supplierCreditNote.update({ where: { id }, data })
  }
}

/**
 * A Super Admin sends a draft back with a note instead of approving it.
 * While `rejectionNote` is set, the draft is off "Waiting for approval"
 * (Task 13) and cannot be approved (each approve function refuses it); the
 * person who prepared it clears the note by saving the draft again.
 */
export async function sendBack(
  kind: ApprovalKind,
  id: string,
  input: { note: string },
  actor: AccessTokenPayload
): Promise<void> {
  if (actor.role !== Role.SUPER_ADMIN) throw new AppError(403, "Only a Super Admin can send this back.")

  const note = input.note.trim()
  if (!note) throw new AppError(400, "Write a note so the person knows what to fix.")

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const draft = await loadDraft(tx, kind, id)
    if (!draft) throw new AppError(404, NOT_FOUND[kind])
    if (draft.status !== "DRAFT") {
      throw new AppError(409, `This ${LABEL[kind]} is already ${draft.status.toLowerCase()}`)
    }

    await updateDraft(tx, kind, id, { rejectionNote: note, sentBackBy: actor.sub, sentBackAt: new Date() })

    await writeAudit(tx, { entity: AUDIT_ENTITY[kind], entityId: id, action: "REJECT", changedBy: actor.sub, note })
  })
}
