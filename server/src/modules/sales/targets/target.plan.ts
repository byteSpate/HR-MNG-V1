/**
 * A yearly target, split into quarters, with shortfalls carried forward.
 *
 * An admin sets one amount of deal value for a date range inside one year
 * (the whole year by default). It is split over the quarters the range
 * covers, each in proportion to how much of the quarter is covered, so a
 * person who joins in July is not measured against January. Every quarter's
 * target is then worked out, never stored:
 *
 * - A quarter's **shortfall** is added to the next quarter's target, so a bad
 *   quarter cannot quietly drop out of sight.
 * - A quarter's **extra** carries nothing. It never lowers the next target; it
 *   counts towards the year only.
 * - A shortfall is carried **only once its quarter has ended**. The current
 *   quarter's shortfall is not a fact yet, so the quarter after it shows its
 *   own share and `carried: null` — "not known yet", not "nothing".
 * - The Q4 shortfall stops at the year end. Next year starts fresh.
 *
 * Pure, so the arithmetic is tested without a database. The caller measures
 * what was won and says which quarters have ended.
 */

import { ZERO, sum, type Money } from "../../payroll/payroll.money"

export type QuarterPhase = "ended" | "current" | "upcoming"

export interface PlannedQuarter {
  quarter: number
  phase: QuarterPhase
  /** This quarter's equal part of the yearly target. Null before the start quarter, or with no target. */
  share: Money | null
  /**
   * The shortfall brought in from the quarter before. Null when nothing can be
   * carried: no target, the start quarter, or a previous quarter still running.
   */
  carried: Money | null
  /**
   * True when a carry may still arrive: the quarter before is covered by the
   * same target but has not ended. The page says "plus any shortfall" rather
   * than showing the share as if it were final.
   */
  carryPending: boolean
  /** Share plus carried. Null means no target covers this quarter — never zero. */
  target: Money | null
  /** Value of the deals won in the quarter, whether or not a target covers it. */
  won: Money
  /** Target minus won. Positive is short, negative is ahead. Null with no target. */
  gap: Money | null
}

/** Where a quarter sits relative to today's quarter. */
export function phaseOf(
  calendarYear: number,
  quarter: number,
  now: { calendarYear: number; quarter: number }
): QuarterPhase {
  if (calendarYear !== now.calendarYear) return calendarYear < now.calendarYear ? "ended" : "upcoming"
  if (quarter < now.quarter) return "ended"
  return quarter === now.quarter ? "current" : "upcoming"
}

/**
 * The dates a target covers, as "YYYY-MM-DD", inside one calendar year
 * (owner, 2026-11-10). A whole-year target is 1 January to 31 December.
 */
export interface TargetRange {
  from: string
  to: string
}

export function wholeYear(calendarYear: number): TargetRange {
  return { from: `${calendarYear}-01-01`, to: `${calendarYear}-12-31` }
}

const DAY = 24 * 60 * 60 * 1000
const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY

/** 1 to 4, from a "YYYY-MM-DD" date. */
export function quarterOfDate(iso: string): number {
  return Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1
}

/**
 * How much of each quarter the range covers, from 0 to 1. A whole quarter is
 * 1, so a whole-year target still splits equally even though Q1 has 90 days
 * and Q3 has 92. 15 to 31 March is 17/90 of Q1.
 */
export function quarterWeights(range: TargetRange): number[] {
  const year = Number(range.from.slice(0, 4))
  const from = dayNumber(range.from)
  const to = dayNumber(range.to)
  return [1, 2, 3, 4].map((quarter) => {
    const qStart = Date.UTC(year, (quarter - 1) * 3, 1) / DAY
    const qEnd = Date.UTC(year, quarter * 3, 0) / DAY
    const covered = Math.min(to, qEnd) - Math.max(from, qStart) + 1
    return covered <= 0 ? 0 : covered / (qEnd - qStart + 1)
  })
}

/**
 * The target split over the quarters the range covers, each in proportion to
 * how much of that quarter is covered. A quarter the range does not touch has
 * no target (null), never zero.
 *
 * Each part is rounded *down* to the paisa and the last covered quarter takes
 * what is left, so the parts always add up to exactly the target.
 */
export function splitRange(amount: Money, range: TargetRange): (Money | null)[] {
  const weights = quarterWeights(range)
  const total = weights.reduce((a, b) => a + b, 0)
  const last = weights.map((w) => w > 0).lastIndexOf(true)
  const parts: (Money | null)[] = weights.map((w) =>
    w === 0 ? null : amount.times(w).dividedBy(total).times(100).floor().dividedBy(100)
  )
  const others = parts.reduce<Money>((acc, part, index) => (part !== null && index !== last ? acc.plus(part) : acc), ZERO)
  parts[last] = amount.minus(others)
  return parts
}

export function planQuarters(input: {
  /** The yearly target, or null when nobody has set one. */
  yearly: Money | null
  /** The dates the target covers. Ignored when `yearly` is null. */
  range: TargetRange | null
  /** Value won in Q1 to Q4, in order. */
  won: Money[]
  /** Q1 to Q4, in order. */
  phases: QuarterPhase[]
}): PlannedQuarter[] {
  const shares =
    input.yearly === null || input.range === null ? [null, null, null, null] : splitRange(input.yearly, input.range)
  const firstQuarter = input.range === null ? 1 : quarterOfDate(input.range.from)
  const plan: PlannedQuarter[] = []

  for (let index = 0; index < 4; index++) {
    const quarter = index + 1
    const share = shares[index]
    const previous = plan[index - 1]
    // Something can be carried in only from a quarter of the same target,
    // which rules out the start quarter and everything before it.
    const fromPrevious =
      share !== null && quarter !== firstQuarter && previous !== undefined && previous.target !== null
        ? previous
        : null
    const carried =
      fromPrevious !== null && fromPrevious.phase === "ended"
        ? shortfall(fromPrevious.target!, fromPrevious.won)
        : null
    const target = share === null ? null : carried === null ? share : share.plus(carried)
    const won = input.won[index]

    plan.push({
      quarter,
      phase: input.phases[index],
      share,
      carried,
      carryPending: fromPrevious !== null && fromPrevious.phase !== "ended",
      target,
      won,
      gap: target === null ? null : target.minus(won),
    })
  }
  return plan
}

/** What was missed. Beating a target leaves nothing to carry, not a credit. */
function shortfall(target: Money, won: Money): Money {
  const missed = target.minus(won)
  return missed.isNegative() ? ZERO : missed
}

/** Null only when every value is null: a sum of nothing is not zero. */
function sumPresent(values: (Money | null)[]): Money | null {
  const present = values.filter((value): value is Money => value !== null)
  return present.length === 0 ? null : sum(present)
}

/**
 * The team's quarters: each person's plan worked out first, then added up.
 * Carrying is per person — one person's extra does not cover another's
 * shortfall — so adding up the wins first and planning once would be wrong.
 */
export function sumPlans(plans: PlannedQuarter[][], phases: QuarterPhase[]): PlannedQuarter[] {
  return [0, 1, 2, 3].map((index) => {
    const target = sumPresent(plans.map((plan) => plan[index].target))
    const won = sum(plans.map((plan) => plan[index].won))
    return {
      quarter: index + 1,
      phase: phases[index],
      share: sumPresent(plans.map((plan) => plan[index].share)),
      carried: sumPresent(plans.map((plan) => plan[index].carried)),
      carryPending: plans.some((plan) => plan[index].carryPending),
      target,
      won,
      gap: target === null ? null : target.minus(won),
    }
  })
}
