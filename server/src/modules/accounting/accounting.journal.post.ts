/**
 * The Super Admin half of the journal lifecycle: approve, reject, reverse.
 *
 * Approval *is* posting (Decision 8). There is no separate Post action and
 * therefore no "approved but somehow not in the ledger" limbo.
 *
 * Separated from accounting.journal.service.ts because these three carry
 * different authority and different guards; keeping them together would
 * make one file the whole lifecycle and the RBAC harder to read at a glance.
 */

import prisma from "../../config/prisma"
import type { Journal, Prisma } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import { nextJournalNo } from "./accounting.journal.service"
import { earliestOpenPeriodFrom, monthLabel } from "./accounting.period.service"
import { assertBalanced, invertLines } from "./accounting.utils"
import { lockYearAfterClosing } from "./accounting.yearend"
import type { ReverseJournalInput, RejectJournalInput } from "./accounting.validators"

const journalInclude = {
  lines: {
    orderBy: { sortOrder: "asc" as const },
    include: { account: { select: { id: true, code: true, name: true, type: true } } },
  },
  attachments: { orderBy: { uploadedAt: "desc" as const } },
  period: { select: { id: true, year: true, month: true, status: true } },
}

/**
 * The transition itself, shared with year-end (Task 8) so the closing
 * journal posts through exactly the same gate as any other.
 */
export async function postApprovedJournal(
  tx: Prisma.TransactionClient,
  journalId: string,
  actor: AccessTokenPayload
): Promise<Journal> {
  const journal = await tx.journal.findUnique({
    where: { id: journalId },
    include: { lines: true },
  })
  if (!journal) throw new AppError(404, "Journal not found")

  // A Super Admin may post a draft straight away, with no submit step first:
  // nobody sits above that role, so there is no one to send it to. Every other
  // role still needs the journal to be submitted.
  const postingDraft = journal.status === "DRAFT" && actor.role === "SUPER_ADMIN"
  if (journal.status !== "PENDING_APPROVAL" && !postingDraft) {
    throw new AppError(409, `${journal.journalNo} is not awaiting approval`)
  }

  // A Super Admin may also approve a journal they created themselves, for the
  // same reason. Finance cannot reach this function at all (the route requires
  // Super Admin), so no other role is affected.

  // Re-checked at approval rather than trusted from submit — a period can
  // close, and a draft can be edited, between the two.
  const period = await tx.accountingPeriod.findUnique({ where: { id: journal.periodId } })
  if (!period) throw new AppError(400, "Period not found")
  if (period.status !== "OPEN") {
    throw new AppError(
      400,
      `${monthLabel(period.year, period.month)} is ${period.status.toLowerCase()}; this journal cannot be posted into it`
    )
  }

  assertBalanced(journal.lines)

  const now = new Date()
  const posted = await tx.journal.update({
    where: { id: journalId },
    data: {
      status: "POSTED",
      approvedBy: actor.sub,
      approvedAt: now,
      postedAt: now,
      rejectionNote: null,
      // Posted straight from a draft: record that the same person sent it in,
      // so the register never shows a posted journal with no submitter.
      ...(postingDraft ? { submittedBy: actor.sub, submittedAt: now } : {}),
    },
  })

  // Two rows, not one. "Who approved this?" and "when did it hit the
  // ledger?" are different questions, and a single row conflates them.
  await writeAudit(tx, {
    entity: "JOURNAL",
    entityId: journalId,
    action: "APPROVE",
    changedBy: actor.sub,
    before: { status: journal.status },
    after: { status: "POSTED" },
  })
  await writeAudit(tx, {
    entity: "JOURNAL",
    entityId: journalId,
    action: "POST",
    changedBy: actor.sub,
    after: { postedAt: now.toISOString(), journalNo: journal.journalNo },
  })

  // A CLOSING journal locks its year in the same transaction that posts it.
  // Two separate steps would leave a window where the year is closed on
  // paper and still accepting entries.
  await lockYearAfterClosing(tx, posted, actor)

  return posted
}

export function approveJournal(id: string, actor: AccessTokenPayload): Promise<Journal> {
  return prisma.$transaction(async (tx) => {
    await postApprovedJournal(tx, id, actor)
    return tx.journal.findUnique({ where: { id }, include: journalInclude }) as Promise<Journal>
  })
}

export function rejectJournal(
  id: string,
  input: RejectJournalInput,
  actor: AccessTokenPayload
): Promise<Journal> {
  return prisma.$transaction(async (tx) => {
    const journal = await tx.journal.findUnique({ where: { id } })
    if (!journal) throw new AppError(404, "Journal not found")
    if (journal.status !== "PENDING_APPROVAL") {
      throw new AppError(409, `${journal.journalNo} is not awaiting approval`)
    }

    const updated = await tx.journal.update({
      where: { id },
      data: {
        status: "DRAFT",
        rejectionNote: input.note,
        // Cleared so the register does not show it as submitted while it
        // sits back on the author's desk.
        submittedBy: null,
        submittedAt: null,
      },
    })

    await writeAudit(tx, {
      entity: "JOURNAL",
      entityId: id,
      action: "REJECT",
      changedBy: actor.sub,
      before: { status: "PENDING_APPROVAL" },
      after: { status: "DRAFT" },
      note: input.note,
    })

    return updated
  })
}

/**
 * A reversal is a new journal, not an edit of the old one. It follows the
 * ordinary approval path — it is a posting like any other — so this returns
 * a DRAFT, and the original does not flip to REVERSED until... it does,
 * here, immediately.
 *
 * That last point is deliberate: the original is marked REVERSED as soon as
 * the reversal is drafted, because `reversesId` is @unique and a second
 * attempt must be refused straight away rather than after somebody has
 * typed a duplicate and waited for approval. If the reversal draft is later
 * deleted, the original returns to POSTED — see `deleteJournal`'s caller
 * note below.
 */
export function reverseJournal(
  id: string,
  input: ReverseJournalInput,
  actor: AccessTokenPayload
): Promise<Journal> {
  return prisma.$transaction(async (tx) => {
    const original = await tx.journal.findUnique({
      where: { id },
      include: { lines: { orderBy: { sortOrder: "asc" } }, reversedBy: { select: { journalNo: true } } },
    })
    if (!original) throw new AppError(404, "Journal not found")
    if (original.status !== "POSTED") {
      throw new AppError(409, `Only a posted journal can be reversed; ${original.journalNo} is ${original.status.toLowerCase().replace("_", " ")}`)
    }
    if (original.reversedBy) {
      throw new AppError(
        409,
        `${original.journalNo} was already reversed by ${original.reversedBy.journalNo}`
      )
    }

    // Decision 9: same period if it is still open, otherwise the earliest
    // open one. A mistake caught before month-end distorts nothing; one
    // caught afterwards leaves the issued month as issued.
    const originalPeriod = await tx.accountingPeriod.findUnique({ where: { id: original.periodId } })
    let date = original.date
    let periodId = original.periodId

    if (!originalPeriod || originalPeriod.status !== "OPEN") {
      const target = await earliestOpenPeriodFrom(tx, original.date)
      periodId = target.id
      date = target.startDate
    }

    const invertedLines = invertLines(original.lines).map((l, i) => ({
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
      narration: l.narration,
      departmentId: l.departmentId,
      employeeId: l.employeeId,
      sourceCurrency: l.sourceCurrency,
      sourceAmount: l.sourceAmount,
      fxRateToBdt: l.fxRateToBdt,
      sortOrder: i,
    }))
    assertBalanced(invertedLines)

    const reversal = await tx.journal.create({
      data: {
        journalNo: await nextJournalNo(tx),
        date,
        periodId,
        type: "REVERSAL",
        status: "DRAFT",
        narration: `Reversal of ${original.journalNo} — ${original.narration}`,
        reference: original.reference,
        reversesId: original.id,
        reversalReason: input.reason,
        createdBy: actor.sub,
        // sourceModule / sourceRefId / sourceEvent stay null on purpose:
        // copying the original's triple would collide with the unique
        // constraint that makes system postings idempotent.
        lines: { createMany: { data: invertedLines } },
      },
    })

    await tx.journal.update({ where: { id }, data: { status: "REVERSED" } })

    await writeAudit(tx, {
      entity: "JOURNAL",
      entityId: id,
      action: "REVERSE",
      changedBy: actor.sub,
      before: { status: "POSTED" },
      after: { status: "REVERSED", reversedBy: reversal.journalNo },
      note: input.reason,
    })
    await writeAudit(tx, {
      entity: "JOURNAL",
      entityId: reversal.id,
      action: "CREATE",
      changedBy: actor.sub,
      after: { journalNo: reversal.journalNo, reverses: original.journalNo },
      note: input.reason,
    })

    return tx.journal.findUnique({ where: { id: reversal.id }, include: journalInclude }) as Promise<Journal>
  })
}
