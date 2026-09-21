/**
 * A yearly target, split into quarters, with shortfalls carried forward.
 *
 * An admin sets one amount of deal value for the year. It is split equally
 * over the quarters from the start quarter to Q4 — a person who joins in July
 * is not measured against January. Every quarter's target is then worked out,
 * never stored:
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
 * The yearly amount in equal parts, one per quarter from `startQuarter`.
 *
 * Each part is rounded *down* to the paisa and Q4 takes what is left, so the
 * parts always add up to exactly the yearly amount and no quarter is asked for
 * a paisa more than its fair share.
 */
export function splitYearly(yearly: Money, startQuarter: number): (Money | null)[] {
  const count = 5 - startQuarter
  const share = yearly.dividedBy(count).times(100).floor().dividedBy(100)
  const last = yearly.minus(share.times(count - 1))
  return [1, 2, 3, 4].map((quarter) =>
    quarter < startQuarter ? null : quarter === 4 ? last : share
  )
}

export function planQuarters(input: {
  /** The yearly target, or null when nobody has set one. */
  yearly: Money | null
  startQuarter: number
  /** Value won in Q1 to Q4, in order. */
  won: Money[]
  /** Q1 to Q4, in order. */
  phases: QuarterPhase[]
}): PlannedQuarter[] {
  const shares = input.yearly === null ? [null, null, null, null] : splitYearly(input.yearly, input.startQuarter)
  const plan: PlannedQuarter[] = []

  for (let index = 0; index < 4; index++) {
    const quarter = index + 1
    const share = shares[index]
    const previous = plan[index - 1]
    // Something can be carried in only from a quarter of the same target,
    // which rules out the start quarter and everything before it.
    const fromPrevious =
      share !== null && quarter !== input.startQuarter && previous !== undefined && previous.target !== null
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
