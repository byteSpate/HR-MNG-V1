/**
 * What makes a card red.
 *
 * One file, so that question has exactly one answer. A threshold scattered
 * across five builders is five thresholds that agreed once.
 */

import type { Tone } from "./dashboard.types"

export const toneFor = {
  /**
   * A stat that reports a fact with no good or bad direction — a total, a
   * count of what exists. Named rather than written as a literal "neutral" at
   * each call site, so "which stats carry no health signal" is a decision
   * recorded in this file with the thresholds, and changing it later is one
   * edit rather than a search.
   */
  informational(): Tone {
    return "neutral"
  },

  /** An approval queue. Empty is the healthy state. */
  queue(count: number): Tone {
    if (count === 0) return "green"
    return count <= 5 ? "yellow" : "red"
  },

  /** How long the oldest item in a queue has been waiting. */
  aging(days: number): Tone {
    if (days < 2) return "neutral"
    return days <= 4 ? "yellow" : "red"
  },

  /** Anything blocking a payroll run. There is no "a bit blocked". */
  blockers(count: number): Tone {
    return count === 0 ? "green" : "red"
  },

  /** How old a reference value is — an exchange rate, say. */
  staleness(days: number): Tone {
    if (days <= 2) return "green"
    return days <= 7 ? "yellow" : "red"
  },

  /**
   * A rate against named thresholds. `good` and `bad` are explicit because
   * the direction differs: 95% attendance is good and 95% attrition is a
   * catastrophe, and no single comparison covers both.
   */
  rate(pct: number, bounds: { good: number; bad: number }): Tone {
    const higherIsBetter = bounds.good > bounds.bad
    if (higherIsBetter) {
      if (pct >= bounds.good) return "green"
      return pct > bounds.bad ? "yellow" : "red"
    }
    if (pct <= bounds.good) return "green"
    return pct < bounds.bad ? "yellow" : "red"
  },
}
