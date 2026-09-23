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

type Line = SystemJournalInput["lines"][number]

interface CreditNoteForPosting {
  id: string
  supplierId: string
  lines: Array<{ billLineId: string; amount: Prisma.Decimal; vatAmount: Prisma.Decimal }>
}

interface BillLineForCredit {
  id: string
  kind: "GOODS" | "SERVICE"
  opportunityId: string
}

/** Every GOODS line still credits 1214 in Phase 2, never 5121, because
 *  Phase 3's delivery event (COST_RELEASE) is what would ever move a
 *  line's cost out of 1214, and it has no caller yet. See the note in the
 *  Phase 2 plan, Task 15. */
export function buildSupplierCreditNoteLines(
  note: CreditNoteForPosting,
  billLines: BillLineForCredit[],
  rules: ResolvedRules
): Line[] {
  const byId = new Map(billLines.map((l) => [l.id, l]))
  const lines: Line[] = []
  let gross = new Prisma.Decimal(0)

  for (const line of note.lines) {
    const billLine = byId.get(line.billLineId)
    if (!billLine) throw new AppError(400, `Credit note line references a bill line that does not exist: ${line.billLineId}`)

    const key = billLine.kind === "GOODS" ? "GOODS" : "SERVICE"
    lines.push({ accountCode: resolveAccountCode(rules, key), credit: line.amount.toFixed(2), opportunityId: billLine.opportunityId })
    gross = gross.plus(line.amount)

    if (!line.vatAmount.isZero()) {
      lines.push({ accountCode: resolveAccountCode(rules, "VAT"), credit: line.vatAmount.toFixed(2), opportunityId: billLine.opportunityId })
      gross = gross.plus(line.vatAmount)
    }
  }

  lines.push({ accountCode: resolveAccountCode(rules, "PAYABLE"), debit: gross.toFixed(2), supplierId: note.supplierId })

  return lines
}

export async function postSupplierCreditNote(tx: PrismaNamespace.TransactionClient, noteId: string, actorUserId: string) {
  const note = await tx.supplierCreditNote.findUniqueOrThrow({
    where: { id: noteId },
    select: {
      id: true, supplierId: true, billId: true,
      lines: { select: { billLineId: true, amount: true, vatAmount: true } },
      supplier: { select: { name: true } },
      bill: { select: { billNumber: true } },
    },
  })
  const billLines = await tx.supplierBillLine.findMany({
    where: { id: { in: note.lines.map((l) => l.billLineId) } },
    select: { id: true, kind: true, opportunityId: true },
  })
  const rules = await loadRules(tx, "SUPPLIER_CREDIT")

  return postSystemJournal(tx, {
    date: toLedgerDate(new Date()),
    narration: `Credit note — ${note.supplier.name} — Bill ${note.bill.billNumber}`,
    source: { module: "SUPPLIER", refId: noteId, event: "CREDIT" },
    lines: buildSupplierCreditNoteLines(note, billLines, rules),
    createdBy: actorUserId,
  })
}

export async function approveSupplierCreditNote(id: string, actor: AccessTokenPayload) {
  const note = await prisma.supplierCreditNote.findUnique({ where: { id } })
  if (!note) throw new AppError(404, "Supplier credit note not found")
  if (note.status !== "DRAFT") throw new AppError(409, `This credit note is already ${note.status.toLowerCase()}`)
  if (note.createdBy === actor.sub) throw new AppError(403, "You prepared this credit note and cannot also approve it")

  return prisma.$transaction(async (tx) => {
    const updated = await tx.supplierCreditNote.update({
      where: { id },
      data: { status: "APPROVED", approvedBy: actor.sub, approvedAt: new Date() },
      include: { lines: true },
    })
    await postSupplierCreditNote(tx, id, actor.sub)
    await writeAudit(tx, { entity: "SUPPLIER_CREDIT_NOTE", entityId: id, action: "APPROVE", changedBy: actor.sub })
    return updated
  })
}
