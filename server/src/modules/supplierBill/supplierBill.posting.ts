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
import { releaseLateCost } from "../receivables/costRelease"

type Line = SystemJournalInput["lines"][number]

interface BillForPosting {
  id: string
  supplierId: string
  // Every line named its own deal until Task 2's migration; now the bill
  // belongs to one deal (spec: "every document belongs to one deal"), so
  // every line posts with the bill's opportunityId.
  opportunityId: string
  lines: Array<{
    id: string
    kind: "GOODS" | "SERVICE"
    amount: Prisma.Decimal
    vatAmount: Prisma.Decimal
  }>
}

/** GOODS lines debit 1214, waiting for delivery; SERVICE lines debit 5129,
 *  expensed on the bill date (design §3.1). VAT debits 1233 per line, so it
 *  carries the same deal dimension as the goods/service it belongs to. One
 *  aggregate credit clears the whole gross to 2111, the payable is a
 *  supplier balance, not itself tied to one deal. */
export function buildSupplierBillLines(bill: BillForPosting, rules: ResolvedRules): Line[] {
  const lines: Line[] = []
  let gross = new Prisma.Decimal(0)

  for (const line of bill.lines) {
    const key = line.kind === "GOODS" ? "GOODS" : "SERVICE"
    lines.push({
      accountCode: resolveAccountCode(rules, key),
      debit: line.amount.toFixed(2),
      opportunityId: bill.opportunityId,
    })
    gross = gross.plus(line.amount)

    if (!line.vatAmount.isZero()) {
      lines.push({
        accountCode: resolveAccountCode(rules, "VAT"),
        debit: line.vatAmount.toFixed(2),
        opportunityId: bill.opportunityId,
      })
      gross = gross.plus(line.vatAmount)
    }
  }

  lines.push({
    accountCode: resolveAccountCode(rules, "PAYABLE"),
    credit: gross.toFixed(2),
    supplierId: bill.supplierId,
  })

  return lines
}

async function loadBillForPosting(tx: PrismaNamespace.TransactionClient, id: string): Promise<BillForPosting> {
  return tx.supplierBill.findUniqueOrThrow({
    where: { id },
    select: { id: true, supplierId: true, opportunityId: true, lines: { select: { id: true, kind: true, amount: true, vatAmount: true } } },
  })
}

export async function postSupplierBillAccrual(tx: PrismaNamespace.TransactionClient, billId: string, actorUserId: string) {
  const [bill, rules] = await Promise.all([loadBillForPosting(tx, billId), loadRules(tx, "SUPPLIER_BILL")])
  const full = await tx.supplierBill.findUniqueOrThrow({
    where: { id: billId },
    select: { billNumber: true, supplier: { select: { name: true } } },
  })
  return postSystemJournal(tx, {
    date: toLedgerDate(new Date()),
    narration: `${full.supplier.name}, bill ${full.billNumber}`,
    source: { module: "SUPPLIER", refId: billId, event: "ACCRUAL" },
    lines: buildSupplierBillLines(bill, rules),
    createdBy: actorUserId,
  })
}

export async function approveSupplierBill(id: string, actor: AccessTokenPayload) {
  const bill = await prisma.supplierBill.findUnique({ where: { id } })
  if (!bill) throw new AppError(404, "Supplier bill not found")
  if (bill.status !== "DRAFT") throw new AppError(409, `This bill is already ${bill.status.toLowerCase()}`)
  if (bill.rejectionNote) {
    throw new AppError(409, "This was sent back. The person who prepared it must save it again first.")
  }
  if (bill.createdBy === actor.sub) throw new AppError(403, "You prepared this bill, so someone else must approve it.")
  if (bill.updatedBy === actor.sub) throw new AppError(403, "You edited this bill, so someone else must approve it.")

  return prisma.$transaction(async (tx) => {
    const updated = await tx.supplierBill.update({
      where: { id },
      data: { status: "APPROVED", approvedBy: actor.sub, approvedAt: new Date() },
      include: { lines: true },
    })
    await postSupplierBillAccrual(tx, id, actor.sub)

    // Review Focus 1: a bill can arrive after its deal is already fully
    // invoiced, with no future invoice left to release the cost it just
    // put into 1214. Offered once for the bill's deal, if it has a GOODS line.
    const hasGoodsLine = updated.lines.some((l) => l.kind === "GOODS")
    if (hasGoodsLine) await releaseLateCost(tx, id, [updated.opportunityId], actor.sub)

    await writeAudit(tx, {
      entity: "SUPPLIER_BILL",
      entityId: id,
      action: "APPROVE",
      changedBy: actor.sub,
    })
    return updated
  })
}
