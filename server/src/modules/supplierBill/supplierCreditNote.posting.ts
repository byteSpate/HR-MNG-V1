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
import { heldGoodsCost } from "../receivables/costRelease"

type Line = SystemJournalInput["lines"][number]

interface CreditNoteForPosting {
  id: string
  supplierId: string
  // The credit note's bill belongs to one deal (spec: every document
  // belongs to one deal), and every line posts with it.
  opportunityId: string
  lines: Array<{ billLineId: string; amount: Prisma.Decimal; vatAmount: Prisma.Decimal }>
}

interface BillLineForCredit {
  id: string
  kind: "GOODS" | "SERVICE"
}

const ZERO = new Prisma.Decimal(0)

/** A GOODS line credits 1214 up to what its deal still holds there — once
 *  Phase 3a's invoice releases cost to 5121, a credit note that still
 *  credited 1214 in full would push the deal's held balance negative — and
 *  5121 for whatever is left, matching design §3.1's "1214, or 5121 if
 *  already delivered". `heldByDeal` is read once, under the credit note's
 *  own lock, and decremented here so two GOODS lines on the same deal split
 *  correctly. */
export function buildSupplierCreditNoteLines(
  note: CreditNoteForPosting,
  billLines: BillLineForCredit[],
  rules: ResolvedRules,
  heldByDeal: Map<string, Prisma.Decimal>
): Line[] {
  const byId = new Map(billLines.map((l) => [l.id, l]))
  const lines: Line[] = []
  let gross = new Prisma.Decimal(0)

  for (const line of note.lines) {
    const billLine = byId.get(line.billLineId)
    if (!billLine) throw new AppError(400, "One of this credit note's lines points to a bill line that does not exist.")

    if (billLine.kind === "GOODS") {
      const opp = note.opportunityId
      const held = Prisma.Decimal.max(heldByDeal.get(opp) ?? ZERO, ZERO)
      const toGoods = Prisma.Decimal.min(line.amount, held)
      const toDelivered = line.amount.minus(toGoods)
      if (!toGoods.isZero()) lines.push({ accountCode: resolveAccountCode(rules, "GOODS"), credit: toGoods.toFixed(2), opportunityId: opp })
      if (!toDelivered.isZero()) lines.push({ accountCode: resolveAccountCode(rules, "DELIVERED"), credit: toDelivered.toFixed(2), opportunityId: opp })
      heldByDeal.set(opp, held.minus(toGoods))
    } else {
      lines.push({ accountCode: resolveAccountCode(rules, "SERVICE"), credit: line.amount.toFixed(2), opportunityId: note.opportunityId })
    }
    gross = gross.plus(line.amount)

    if (!line.vatAmount.isZero()) {
      lines.push({ accountCode: resolveAccountCode(rules, "VAT"), credit: line.vatAmount.toFixed(2), opportunityId: note.opportunityId })
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
      bill: { select: { billNumber: true, opportunityId: true } },
    },
  })
  const billLines = await tx.supplierBillLine.findMany({
    where: { id: { in: note.lines.map((l) => l.billLineId) } },
    select: { id: true, kind: true },
  })
  const rules = await loadRules(tx, "SUPPLIER_CREDIT")
  const goodsCode = resolveAccountCode(rules, "GOODS")

  // The bill (and so this credit note) belongs to one deal. One read, done
  // once before the lines are built, so two GOODS lines split against the
  // same starting balance rather than each re-reading it fresh.
  const hasGoodsLine = billLines.some((l) => l.kind === "GOODS")
  const heldByDeal = new Map(
    hasGoodsLine ? [[note.bill.opportunityId, await heldGoodsCost(tx, note.bill.opportunityId, goodsCode)] as const] : []
  )

  return postSystemJournal(tx, {
    date: toLedgerDate(new Date()),
    narration: `Credit note — ${note.supplier.name} — Bill ${note.bill.billNumber}`,
    source: { module: "SUPPLIER", refId: noteId, event: "CREDIT" },
    lines: buildSupplierCreditNoteLines({ ...note, opportunityId: note.bill.opportunityId }, billLines, rules, heldByDeal),
    createdBy: actorUserId,
  })
}

export async function approveSupplierCreditNote(id: string, actor: AccessTokenPayload) {
  const note = await prisma.supplierCreditNote.findUnique({ where: { id } })
  if (!note) throw new AppError(404, "Supplier credit note not found")
  if (note.status !== "DRAFT") throw new AppError(409, `This credit note is already ${note.status.toLowerCase()}`)
  if (note.rejectionNote) {
    throw new AppError(409, "This was sent back. The person who prepared it must save it again first.")
  }
  if (note.createdBy === actor.sub) throw new AppError(403, "You prepared this credit note, so someone else must approve it.")

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
