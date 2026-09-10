/**
 * Quarterly targets, and the achievement measured against them.
 *
 * **A target is a count of deals, not an amount of money** (decision C1). That
 * removes a whole class of problem: a won deal counts as one whether or not
 * anybody has typed a value against it, so an unpriced win needs no special
 * handling in the arithmetic. Deal value is still reported — beside the count,
 * never as the thing the target measures.
 *
 * **Achievement is computed, never stored.** Reopening a won deal therefore
 * moves a past quarter's number, which is accepted (§6): freezing it at
 * quarter end would hide a correction, and a scoreboard that hides corrections
 * is worse than one that moves.
 */

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import { Role, SalesRole } from "../../generated/prisma/client"
import type { AccessTokenPayload } from "../auth/auth.types"
import { dec, sum, toMoneyString } from "../payroll/payroll.money"
import { employeeIdFor } from "./sales.access"
import { quarterRange } from "./sales.quarters"

export interface SalesTargetQuarter {
  quarter: number
  /** Null means nobody set one. Never 0 — that would be a decision nobody made. */
  target: number | null
  note: string | null
  /** Count of deals won and closed inside the quarter. */
  achievement: number
  /** Sum of the priced wins. Shown beside the count, never as the target. */
  valueWon: string
  /** How many of those wins carry no value, so the total can be read honestly. */
  unpricedWonCount: number
}

export interface SalesTargetYear {
  employeeId: string
  employeeName: string
  calendarYear: number
  /** Always four, in order, whether or not any target was set. */
  quarters: SalesTargetQuarter[]
}

export interface GetTargetYearQuery {
  calendarYear: number
  employeeId?: string
}

export interface SetSalesTargetBody {
  employeeId: string
  calendarYear: number
  quarter: number
  targetDeals: number
  note?: string
}

function isSalesAdmin(actor: AccessTokenPayload): boolean {
  return actor.role === Role.SUPER_ADMIN || actor.salesRole === SalesRole.SALES_ADMIN
}

/**
 * Deals won and closed inside one quarter, for one person.
 *
 * Two filters do the work, and both are load-bearing:
 *
 * - `wonByEmployeeId`, not `ownerEmployeeId`. Credit belongs to whoever ran the
 *   deal on the day it was won, and handing the account over later does not
 *   rewrite who closed what (C3).
 * - `status: WON`. `wonByEmployeeId` is deliberately never cleared, so it
 *   survives a reopen. A deal won, reopened and then lost still carries the
 *   original winner's id, and without this filter it would still be counted as
 *   a win.
 */
async function achievementFor(
  employeeId: string,
  calendarYear: number,
  quarter: number
): Promise<Pick<SalesTargetQuarter, "achievement" | "valueWon" | "unpricedWonCount">> {
  const { start, end } = quarterRange(calendarYear, quarter)
  const wins = await prisma.opportunity.findMany({
    where: {
      wonByEmployeeId: employeeId,
      status: "WON",
      closedAt: { gte: start, lt: end },
    },
    select: { amount: true },
  })

  const priced = wins.filter((deal) => deal.amount !== null)
  return {
    achievement: wins.length,
    valueWon: toMoneyString(sum(priced.map((deal) => dec(deal.amount!)))),
    unpricedWonCount: wins.length - priced.length,
  }
}

/**
 * One employee's four quarters: what was asked of them, and what happened.
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
    // an empty year, which would read as a year with no targets set.
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

  const rows = await prisma.salesTarget.findMany({
    where: { employeeId: subjectId, calendarYear: query.calendarYear },
    select: { quarter: true, targetDeals: true, note: true },
  })
  const byQuarter = new Map(rows.map((row) => [row.quarter, row]))

  // Issued in order, so Q1 is the first query. The four are independent and
  // there is no reason to wait for one before starting the next.
  const quarters = await Promise.all(
    [1, 2, 3, 4].map(async (quarter) => {
      const measured = await achievementFor(subjectId, query.calendarYear, quarter)
      const target = byQuarter.get(quarter)
      return {
        quarter,
        target: target?.targetDeals ?? null,
        note: target?.note ?? null,
        ...measured,
      }
    })
  )

  return {
    employeeId: employee.id,
    employeeName: employee.fullName,
    calendarYear: query.calendarYear,
    quarters,
  }
}

/**
 * Set or change one quarter's target. Sales Admin and Super Admin only (§11) —
 * a target somebody sets for themselves is not a target.
 */
export async function setSalesTarget(
  body: SetSalesTargetBody,
  actor: AccessTokenPayload
): Promise<SalesTargetQuarter> {
  if (!isSalesAdmin(actor)) {
    throw new AppError(403, "Only a Sales Admin can set a quarterly target")
  }

  const employee = await prisma.employee.findUnique({
    where: { id: body.employeeId },
    select: { id: true, fullName: true },
  })
  if (!employee) {
    throw new AppError(400, "That target is not for an employee")
  }

  const row = await prisma.$transaction(async (tx) => {
    const saved = await tx.salesTarget.upsert({
      where: {
        employeeId_calendarYear_quarter: {
          employeeId: body.employeeId,
          calendarYear: body.calendarYear,
          quarter: body.quarter,
        },
      },
      create: {
        employeeId: body.employeeId,
        calendarYear: body.calendarYear,
        quarter: body.quarter,
        targetDeals: body.targetDeals,
        note: body.note ?? null,
        setBy: actor.sub,
      },
      update: {
        targetDeals: body.targetDeals,
        note: body.note ?? null,
        setBy: actor.sub,
      },
    })

    await writeAudit(tx, {
      entity: "SALES_TARGET",
      entityId: saved.id,
      action: "UPDATE",
      changedBy: actor.sub,
      after: {
        employeeId: body.employeeId,
        calendarYear: body.calendarYear,
        quarter: body.quarter,
        targetDeals: body.targetDeals,
      },
    })

    return saved
  })

  const measured = await achievementFor(body.employeeId, body.calendarYear, body.quarter)
  return {
    quarter: row.quarter,
    target: row.targetDeals,
    note: row.note,
    ...measured,
  }
}
