/**
 * Yearly targets, and the achievement measured against them.
 *
 * **A target is an amount of deal value for the year** (decided 2026-09-13,
 * replacing C1's quarterly count of deals). An admin sets one amount per
 * person per year and a start quarter; `target.plan.ts` splits it over the
 * quarters from there and carries each ended quarter's shortfall into the
 * next. A won deal with no price adds nothing to the value, so it is counted
 * and named beside it rather than summed as zero.
 *
 * **Achievement is computed, never stored.** Reopening a won deal therefore
 * moves a past quarter's number — and, through the carry, the later quarters'
 * targets with it. That is accepted (§6): freezing the figures at quarter end
 * would hide a correction, and a scoreboard that hides corrections is worse
 * than one that moves.
 */

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import { Role, SalesRole } from "../../generated/prisma/client"
import type { AccessTokenPayload } from "../auth/auth.types"
import { ZERO, dec, sum, toMoneyString, type Money } from "../payroll/payroll.money"
import { employeeIdFor } from "./sales.access"
import { currentQuarter, quarterOf, quarterRange } from "./sales.quarters"
import { phaseOf, planQuarters, type PlannedQuarter, type QuarterPhase } from "./target.plan"

export interface SalesTargetQuarter {
  quarter: number
  /** Whether the quarter is over. Only an ended quarter's shortfall is carried. */
  phase: QuarterPhase
  /** This quarter's equal part of the yearly target. */
  share: string | null
  /** Shortfall brought in from the quarter before; null when not known or not possible. */
  carried: string | null
  /** A carry may still arrive: the quarter before has not ended yet. */
  carryPending: boolean
  /** Share plus carried. Null means no target covers the quarter — never "0.00". */
  target: string | null
  /** Sum of the priced wins. */
  valueWon: string
  dealsWon: number
  /** Wins with no price, left out of `valueWon` and named instead. */
  unpricedWonCount: number
  /** Target minus won: positive is short, negative is ahead. */
  gap: string | null
}

export interface SalesTargetYear {
  employeeId: string
  employeeName: string
  calendarYear: number
  /** Null means nobody set one. Never "0.00" — that would be a decision nobody made. */
  yearlyTarget: string | null
  startQuarter: number | null
  note: string | null
  valueWon: string
  dealsWon: number
  unpricedWonCount: number
  /** Always four, in order, whether or not a target was set. */
  quarters: SalesTargetQuarter[]
}

export interface GetTargetYearQuery {
  calendarYear: number
  employeeId?: string
  /** Injected so a test can pin which quarters have ended. Production passes nothing. */
  now?: Date
}

export interface SetSalesTargetBody {
  employeeId: string
  calendarYear: number
  amount: string
  startQuarter: number
  note?: string
}

/** A won deal, as much of it as a year needs. */
export interface WinRow {
  amount: Money | null
  closedAt: Date | null
}

function isSalesAdmin(actor: AccessTokenPayload): boolean {
  return actor.role === Role.SUPER_ADMIN || actor.salesRole === SalesRole.SALES_ADMIN
}

const moneyOrNull = (value: Money | null) => (value === null ? null : toMoneyString(value))

/** The office-local calendar year, half-open, so a deal belongs to exactly one year. */
export function yearRange(calendarYear: number): { gte: Date; lt: Date } {
  return { gte: quarterRange(calendarYear, 1).start, lt: quarterRange(calendarYear, 4).end }
}

/** Which quarters of `calendarYear` are over, as seen at `now`. */
export function phasesOf(calendarYear: number, now: Date): QuarterPhase[] {
  const today = currentQuarter(now)
  return [1, 2, 3, 4].map((quarter) => phaseOf(calendarYear, quarter, today))
}

/** A year's wins, bucketed by the office-local quarter they closed in. */
export function winsByQuarter(rows: WinRow[]): { value: Money[]; deals: number[]; unpriced: number[] } {
  const value = [ZERO, ZERO, ZERO, ZERO]
  const deals = [0, 0, 0, 0]
  const unpriced = [0, 0, 0, 0]
  for (const row of rows) {
    // Leaving ONGOING always stamps closedAt; a WON row without one cannot be
    // placed in a quarter, so it is not guessed into one.
    if (!row.closedAt) continue
    const index = quarterOf(row.closedAt) - 1
    deals[index] += 1
    if (row.amount === null) unpriced[index] += 1
    else value[index] = value[index].plus(dec(row.amount))
  }
  return { value, deals, unpriced }
}

export function presentQuarter(
  planned: PlannedQuarter,
  dealsWon: number,
  unpricedWonCount: number
): SalesTargetQuarter {
  return {
    quarter: planned.quarter,
    phase: planned.phase,
    share: moneyOrNull(planned.share),
    carried: moneyOrNull(planned.carried),
    carryPending: planned.carryPending,
    target: moneyOrNull(planned.target),
    valueWon: toMoneyString(planned.won),
    dealsWon,
    unpricedWonCount,
    gap: moneyOrNull(planned.gap),
  }
}

const total = (values: number[]) => values.reduce((a, b) => a + b, 0)

/** One person's year: their target row, if there is one, measured against their wins. */
export function presentYear(
  employee: { id: string; fullName: string },
  calendarYear: number,
  target: { amount: Money; startQuarter: number; note: string | null } | null,
  wins: WinRow[],
  now: Date
): SalesTargetYear {
  const bucket = winsByQuarter(wins)
  const plan = planQuarters({
    yearly: target ? dec(target.amount) : null,
    startQuarter: target?.startQuarter ?? 1,
    won: bucket.value,
    phases: phasesOf(calendarYear, now),
  })
  return {
    employeeId: employee.id,
    employeeName: employee.fullName,
    calendarYear,
    yearlyTarget: target ? toMoneyString(dec(target.amount)) : null,
    startQuarter: target?.startQuarter ?? null,
    note: target?.note ?? null,
    valueWon: toMoneyString(sum(bucket.value)),
    dealsWon: total(bucket.deals),
    unpricedWonCount: total(bucket.unpriced),
    quarters: plan.map((planned, index) =>
      presentQuarter(planned, bucket.deals[index], bucket.unpriced[index])
    ),
  }
}

/**
 * Deals one person won in a year. Two filters do the work, and both are
 * load-bearing:
 *
 * - `wonByEmployeeId`, not `ownerEmployeeId`. Credit belongs to whoever ran the
 *   deal on the day it was won, and handing the account over later does not
 *   rewrite who closed what (C3).
 * - `status: WON`. `wonByEmployeeId` is deliberately never cleared, so it
 *   survives a reopen. A deal won, reopened and then lost still carries the
 *   original winner's id, and without this filter it would still count.
 */
async function winsFor(employeeId: string, calendarYear: number): Promise<WinRow[]> {
  return prisma.opportunity.findMany({
    where: { wonByEmployeeId: employeeId, status: "WON", closedAt: yearRange(calendarYear) },
    select: { amount: true, closedAt: true },
  })
}

/**
 * One employee's year: what was asked of them, and what happened.
 *
 * A Sales User sees their own. An admin sees anybody's. The refusal comes
 * before any database work, so an unauthorised caller cannot learn whether an
 * employee id exists by timing the response.
 */
export async function getTargetYear(
  query: GetTargetYearQuery,
  actor: AccessTokenPayload
): Promise<SalesTargetYear> {
  const ownEmployeeId = await employeeIdFor(actor)
  const subjectId = query.employeeId ?? ownEmployeeId

  if (query.employeeId && query.employeeId !== ownEmployeeId && !isSalesAdmin(actor)) {
    throw new AppError(403, "You can only see your own targets")
  }
  if (!subjectId) {
    // Super Admin and HR Admin are seeded with no Employee row, so there is
    // nobody for "my targets" to be about. Said plainly rather than returned as
    // an empty year, which would read as a year with no target set.
    throw new AppError(
      400,
      "Your account has no employee record, so it has no sales targets. Ask for a specific employee instead."
    )
  }

  const employee = await prisma.employee.findUnique({
    where: { id: subjectId },
    select: { id: true, fullName: true },
  })
  if (!employee) {
    throw new AppError(404, "That employee does not exist")
  }

  const [targets, wins] = await Promise.all([
    prisma.salesTarget.findMany({
      where: { employeeId: subjectId, calendarYear: query.calendarYear },
      select: { amount: true, startQuarter: true, note: true },
    }),
    winsFor(subjectId, query.calendarYear),
  ])

  return presentYear(employee, query.calendarYear, targets[0] ?? null, wins, query.now ?? new Date())
}

/**
 * Set or change one person's yearly target. Sales Admin and Super Admin only
 * (§11) — a target somebody sets for themselves is not a target.
 *
 * Answers with the whole year worked out again, because changing the amount
 * or the start quarter moves every quarter's target at once.
 */
export async function setSalesTarget(
  body: SetSalesTargetBody,
  actor: AccessTokenPayload,
  now: Date = new Date()
): Promise<SalesTargetYear> {
  if (!isSalesAdmin(actor)) {
    throw new AppError(403, "Only a Sales Admin can set a yearly target")
  }

  const employee = await prisma.employee.findUnique({
    where: { id: body.employeeId },
    select: { id: true, fullName: true },
  })
  if (!employee) {
    throw new AppError(400, "That target is not for an employee")
  }

  const amount = dec(body.amount)
  const key = {
    employeeId_calendarYear: { employeeId: body.employeeId, calendarYear: body.calendarYear },
  }

  const saved = await prisma.$transaction(async (tx) => {
    const previous = await tx.salesTarget.findUnique({
      where: key,
      select: { amount: true, startQuarter: true },
    })
    const row = await tx.salesTarget.upsert({
      where: key,
      create: {
        employeeId: body.employeeId,
        calendarYear: body.calendarYear,
        amount,
        startQuarter: body.startQuarter,
        note: body.note ?? null,
        setBy: actor.sub,
      },
      update: {
        amount,
        startQuarter: body.startQuarter,
        note: body.note ?? null,
        setBy: actor.sub,
      },
    })

    await writeAudit(tx, {
      entity: "SALES_TARGET",
      entityId: row.id,
      action: previous ? "UPDATE" : "CREATE",
      changedBy: actor.sub,
      ...(previous
        ? {
            before: {
              amount: toMoneyString(dec(previous.amount)),
              startQuarter: previous.startQuarter,
            },
          }
        : {}),
      after: {
        employeeId: body.employeeId,
        calendarYear: body.calendarYear,
        amount: toMoneyString(amount),
        startQuarter: body.startQuarter,
      },
    })

    return row
  })

  const wins = await winsFor(body.employeeId, body.calendarYear)
  return presentYear(employee, body.calendarYear, saved, wins, now)
}
