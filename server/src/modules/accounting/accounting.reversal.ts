import type { Prisma as PrismaNamespace } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { invertLines } from "./accounting.utils"
import { nextJournalNo } from "./accounting.journal.service"

/**
 * Drafts the reversal of a POSTED journal (lines inverted, same date and
 * period, every dimension copied — department, employee, the deal, the
 * customer, the supplier, and the FX memo fields) and marks the original
 * REVERSED. The reversal enters the manual approval queue as a DRAFT, as
 * depreciation's always has.
 */
export async function draftReversal(
  tx: PrismaNamespace.TransactionClient,
  journalId: string,
  reason: string,
  actorUserId: string
): Promise<{ id: string; journalNo: string }> {
  const original = await tx.journal.findUniqueOrThrow({
    where: { id: journalId },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  })
  if (original.status !== "POSTED") {
    throw new AppError(409, `${original.journalNo} is not posted, so it cannot be reversed.`)
  }

  const invertedLines = invertLines(original.lines).map((l, i) => ({
    accountId: l.accountId,
    debit: l.debit,
    credit: l.credit,
    narration: l.narration,
    departmentId: l.departmentId,
    employeeId: l.employeeId,
    opportunityId: l.opportunityId,
    customerId: l.customerId,
    supplierId: l.supplierId,
    sourceCurrency: l.sourceCurrency,
    sourceAmount: l.sourceAmount,
    fxRateToBdt: l.fxRateToBdt,
    sortOrder: i,
  }))

  const reversal = await tx.journal.create({
    data: {
      journalNo: await nextJournalNo(tx),
      date: original.date,
      periodId: original.periodId,
      type: "REVERSAL",
      status: "DRAFT",
      narration: `Reversal of ${original.journalNo}: ${original.narration}`,
      reversesId: original.id,
      reversalReason: reason,
      createdBy: actorUserId,
      lines: { createMany: { data: invertedLines } },
    },
  })

  await tx.journal.update({ where: { id: original.id }, data: { status: "REVERSED" } })

  return { id: reversal.id, journalNo: reversal.journalNo }
}
