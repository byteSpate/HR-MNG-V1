import type { JournalLine, Prisma as PrismaNamespace } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { invertLines } from "./accounting.utils"
import { nextJournalNo } from "./accounting.journal.service"
import { monthLabel } from "./accounting.period.service"

/** Every dimension copied — department, employee, the deal, the customer,
 *  the supplier, and the FX memo fields — not only accountId/debit/credit.
 *  Losing a dimension here was a real bug caught when this helper was
 *  written; both reversal paths share it so neither can regress it. */
function invertedLineRows(lines: JournalLine[]) {
  return invertLines(lines).map((l, i) => ({
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
}

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

  const invertedLines = invertedLineRows(original.lines)

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

/**
 * Same construction as `draftReversal` — lines inverted, every dimension
 * copied, original marked REVERSED — but posted at once (status POSTED,
 * `reversesId` set) instead of left as a DRAFT awaiting a second approval.
 * Used by receipts (Task 6): the Super Admin who reverses the receipt *is*
 * the approval, the same reasoning `postApprovedJournal` applies to a
 * submitted journal, so there is no second approver to hand a DRAFT to.
 *
 * The closed-period check `postApprovedJournal` runs at approval time still
 * applies here, since this skips that approval step entirely: a period can
 * close between the original posting and the reversal, and posting straight
 * into a closed period would corrupt a month that has already been signed
 * off.
 */
export async function postReversalNow(
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

  const period = await tx.accountingPeriod.findUnique({ where: { id: original.periodId } })
  if (!period) throw new AppError(400, "Period not found")
  if (period.status !== "OPEN") {
    throw new AppError(
      400,
      `${monthLabel(period.year, period.month)} is ${period.status.toLowerCase()}; this journal cannot be posted into it`
    )
  }

  const invertedLines = invertedLineRows(original.lines)

  const now = new Date()
  const reversal = await tx.journal.create({
    data: {
      journalNo: await nextJournalNo(tx),
      date: original.date,
      periodId: original.periodId,
      type: "REVERSAL",
      status: "POSTED",
      narration: `Reversal of ${original.journalNo}: ${original.narration}`,
      reversesId: original.id,
      reversalReason: reason,
      createdBy: actorUserId,
      approvedBy: actorUserId,
      approvedAt: now,
      postedAt: now,
      lines: { createMany: { data: invertedLines } },
    },
  })

  await tx.journal.update({ where: { id: original.id }, data: { status: "REVERSED" } })

  return { id: reversal.id, journalNo: reversal.journalNo }
}
