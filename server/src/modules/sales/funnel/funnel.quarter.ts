import prisma from "../../../config/prisma"
import { dec } from "../../payroll/payroll.money"
import { presentYear, yearRange } from "../targets/target.service"
import { quarterDays, summaryOf } from "./funnel.summary"
import type { FunnelSummary } from "./funnel.types"

/**
 * The quarter strip's figures for several people at once (owner,
 * 2026-10-13): four reads in total, whatever the head count.
 *
 * Target, Won and Gap come from the Targets maths (`presentYear`), so the
 * strip always says what the Targets page says. Open quoted is the open
 * Funnel Opportunities closing in the quarter; Quotes missing is the open
 * Funnel Opportunities with no quote at all, in any quarter.
 */
export async function readQuarterSummaries(
  people: { id: string; fullName: string }[],
  year: number,
  quarter: number,
  now: Date,
): Promise<Map<string, FunnelSummary>> {
  const out = new Map<string, FunnelSummary>()
  if (people.length === 0) return out
  const ids = people.map((p) => p.id)

  const [targets, wins, open, missing] = await Promise.all([
    prisma.salesTarget.findMany({
      where: { employeeId: { in: ids }, calendarYear: year },
      select: { employeeId: true, amount: true, startQuarter: true, note: true },
    }),
    prisma.opportunity.findMany({
      where: { wonByEmployeeId: { in: ids }, status: "WON", closedAt: yearRange(year) },
      select: { wonByEmployeeId: true, amount: true, closedAt: true },
    }),
    prisma.opportunity.groupBy({
      by: ["ownerEmployeeId"],
      where: {
        ownerEmployeeId: { in: ids }, offeredOn: { not: null }, status: "ONGOING",
        expectedCloseDate: quarterDays(year, quarter),
      },
      _sum: { amount: true },
      _count: { amount: true },
    }),
    prisma.opportunity.groupBy({
      by: ["ownerEmployeeId"],
      where: { ownerEmployeeId: { in: ids }, offeredOn: { not: null }, status: "ONGOING", quotes: { none: {} } },
      _count: { _all: true },
    }),
  ])

  const targetBy = new Map(targets.map((t) => [t.employeeId, t]))
  const openBy = new Map(open.map((g) => [g.ownerEmployeeId, g]))
  const missingBy = new Map(missing.map((g) => [g.ownerEmployeeId, g._count._all]))

  for (const person of people) {
    const target = targetBy.get(person.id)
    const year_ = presentYear(
      person,
      year,
      target ? { amount: dec(target.amount), startQuarter: target.startQuarter, note: target.note } : null,
      wins
        .filter((w) => w.wonByEmployeeId === person.id)
        .map((w) => ({ amount: w.amount === null ? null : dec(w.amount), closedAt: w.closedAt })),
      now,
    )
    const q = year_.quarters[quarter - 1]
    const openRow = openBy.get(person.id)
    out.set(
      person.id,
      summaryOf({
        year,
        quarter,
        target: q.target,
        won: q.valueWon,
        gap: q.gap,
        openQuoted: openRow && openRow._count.amount > 0 && openRow._sum.amount !== null ? dec(openRow._sum.amount) : null,
        quoteMissingCount: missingBy.get(person.id) ?? 0,
      }),
    )
  }
  return out
}
