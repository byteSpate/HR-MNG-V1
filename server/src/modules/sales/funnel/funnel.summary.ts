/**
 * The Funnel's quarter maths (owner, 2026-10-13). Pure, so the grid, the
 * strip and the team view all count a quarter the same way.
 *
 * Quarters are calendar quarters (January to March is Q1), as Targets count
 * them. `expectedCloseDate` and quote dates are date-only values at UTC
 * midnight, so a date's quarter is read from its UTC parts.
 */

import { dec, toMoneyString, type Money } from "../../payroll/payroll.money"
import { MS_PER_DAY } from "../../../utils/dates"
import type { FunnelSummary } from "./funnel.types"

export function quarterOfDay(d: Date): { year: number; quarter: number } {
  return { year: d.getUTCFullYear(), quarter: Math.floor(d.getUTCMonth() / 3) + 1 }
}

export function quarterLabel(year: number, quarter: number): string {
  return `Q${quarter} ${year}`
}

/** "2026-Q3" (the query's form). The validator has already checked the shape. */
export function parseQuarter(raw: string): { year: number; quarter: number } {
  const [year, quarter] = raw.split("-Q")
  return { year: Number(year), quarter: Number(quarter) }
}

/** The quarter's days as a half-open range, for a `where` on a date-only column. */
export function quarterDays(year: number, quarter: number): { gte: Date; lt: Date } {
  return { gte: new Date(Date.UTC(year, (quarter - 1) * 3, 1)), lt: new Date(Date.UTC(year, quarter * 3, 1)) }
}

/** Whole days from one date-only value to another. Negative when `to` is earlier. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY)
}

/**
 * How many times the open quotes cover what is still to win. Null with no
 * target, or with nothing open priced: a ratio over a guess is not a figure.
 * A gap of zero or less is "Target met", not a ratio.
 */
export function coverageOf(openQuoted: Money | null, gap: Money | null): { coverage: string | null; targetMet: boolean } {
  if (gap === null) return { coverage: null, targetMet: false }
  if (gap.lte(0)) return { coverage: null, targetMet: true }
  if (openQuoted === null) return { coverage: null, targetMet: false }
  return { coverage: openQuoted.div(gap).toFixed(1), targetMet: false }
}

export function summaryOf(input: {
  year: number
  quarter: number
  target: string | null
  won: string
  gap: string | null
  openQuoted: Money | null
  quoteMissingCount: number
}): FunnelSummary {
  return {
    quarterLabel: quarterLabel(input.year, input.quarter),
    target: input.target,
    won: input.won,
    gap: input.gap,
    openQuoted: input.openQuoted === null ? null : toMoneyString(input.openQuoted),
    ...coverageOf(input.openQuoted, input.gap === null ? null : dec(input.gap)),
    quoteMissingCount: input.quoteMissingCount,
  }
}
