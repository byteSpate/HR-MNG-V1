/**
 * The seam every future module posts through.
 *
 * **Nothing calls this in slice 1.** It ships built and tested with no
 * caller, so slice 3 can wire payroll, expenses, operating costs and
 * settlements into the ledger without touching this module's schema. Three
 * columns on Journal, one unique constraint on the triple, and this
 * function are the whole mechanism.
 *
 * Four properties make it the right shape:
 *
 * 1. **It takes a `tx`** and never opens one. A payroll run and its journal
 *    commit or roll back together; there is no window in which a run is
 *    disbursed and the ledger does not know.
 * 2. **Accounts are addressed by `code`.** A caller holds "5201", never an
 *    Account uuid it would have to look up and cache.
 * 3. **It is idempotent.** A duplicate hits
 *    @@unique([sourceModule, sourceRefId, sourceEvent]); P2002 is caught and
 *    the existing journal returned, so retrying a disbursement is safe.
 * 4. **The dependency runs one way.** Payroll imports accounting; accounting
 *    never imports payroll. `expense.sweep.ts` is the precedent — it lives
 *    in the expense module and is called by payroll, deliberately, to keep
 *    the import cycle open.
 *
 * System journals post directly as POSTED without entering the approval
 * queue: the human already approved the payroll run, and a second approval
 * of the arithmetic that follows from it is a rubber stamp. Slice 3 may
 * revisit that; nothing in slice 1 depends on the answer.
 */

import type { Journal, Prisma } from "../../generated/prisma/client"
import { Prisma as P } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import { nextJournalNo } from "./accounting.journal.service"
import { resolveOpenPeriod } from "./accounting.period.service"
import type { SystemJournalInput } from "./accounting.types"
import { assertBalanced, toLedgerDate } from "./accounting.utils"

const ZERO = new P.Decimal(0)

const journalInclude = {
  lines: {
    orderBy: { sortOrder: "asc" as const },
    include: { account: { select: { id: true, code: true, name: true, type: true } } },
  },
}

export async function postSystemJournal(
  tx: Prisma.TransactionClient,
  input: SystemJournalInput
): Promise<Journal> {
  const codes = [...new Set(input.lines.map((l) => l.accountCode))]
  const accounts = await tx.account.findMany({ where: { code: { in: codes } } })
  const byCode = new Map(accounts.map((a) => [a.code, a]))

  for (const code of codes) {
    const account = byCode.get(code)
    if (!account) {
      throw new AppError(400, `Account ${code} does not exist in the chart of accounts`)
    }
    if (account.isGroup) {
      throw new AppError(400, `Account ${code} (${account.name}) is a group and cannot be posted to`)
    }
    if (!account.isActive) {
      throw new AppError(400, `Account ${code} (${account.name}) is inactive`)
    }
  }

  const lineData = input.lines.map((l, i) => ({
    accountId: byCode.get(l.accountCode)!.id,
    debit: l.debit ? new P.Decimal(l.debit) : ZERO,
    credit: l.credit ? new P.Decimal(l.credit) : ZERO,
    narration: l.narration ?? null,
    departmentId: l.departmentId ?? null,
    employeeId: l.employeeId ?? null,
    opportunityId: l.opportunityId ?? null,
    customerId: l.customerId ?? null,
    supplierId: l.supplierId ?? null,
    // Memo only, and null on a BDT transaction. Nothing computes from them —
    // but a caller that bothers to work out "USD 50,000 at 122.50" should not
    // have it silently dropped on the way in.
    sourceCurrency: l.sourceCurrency ?? null,
    sourceAmount: l.sourceAmount ? new P.Decimal(l.sourceAmount) : null,
    fxRateToBdt: l.fxRateToBdt ? new P.Decimal(l.fxRateToBdt) : null,
    sortOrder: i,
  }))

  // A generated entry is held to exactly the same rule as a typed one. A
  // machine that can post an unbalanced journal is worse than a person who
  // can, because nobody is looking.
  assertBalanced(lineData)

  // Truncated, not trusted. Callers hold real timestamps — a payroll run's
  // `createdAt`, a disbursement's `new Date()` — and an instant carrying a
  // time of day resolves to no period at all on the last day of a month.
  const date = toLedgerDate(input.date)
  const period = await resolveOpenPeriod(tx, date)

  const now = new Date()
  let created: { id: string }

  try {
    created = await tx.journal.create({
      data: {
        journalNo: await nextJournalNo(tx),
        date,
        periodId: period.id,
        type: "SYSTEM",
        status: "POSTED",
        narration: input.narration,
        reference: input.reference ?? null,
        sourceModule: input.source.module,
        sourceRefId: input.source.refId,
        sourceEvent: input.source.event,
        createdBy: input.createdBy,
        approvedBy: input.createdBy,
        approvedAt: now,
        postedAt: now,
        lines: { createMany: { data: lineData } },
      },
    })
  } catch (err) {
    // The idempotency path. A retried disbursement must be safe, so the
    // duplicate is answered with the journal that already exists rather
    // than with an error the caller would have to interpret.
    if (err instanceof P.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await tx.journal.findFirst({
        where: {
          sourceModule: input.source.module,
          sourceRefId: input.source.refId,
          sourceEvent: input.source.event,
        },
      })
      if (existing) {
        return tx.journal.findUnique({
          where: { id: existing.id },
          include: journalInclude,
        }) as Promise<Journal>
      }
    }
    throw err
  }

  await writeAudit(tx, {
    entity: "JOURNAL",
    entityId: created.id,
    action: "POST",
    changedBy: input.createdBy,
    after: {
      sourceModule: input.source.module,
      sourceRefId: input.source.refId,
      sourceEvent: input.source.event,
      lineCount: lineData.length,
    },
  })

  return tx.journal.findUnique({
    where: { id: created.id },
    include: journalInclude,
  }) as Promise<Journal>
}
