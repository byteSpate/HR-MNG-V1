import { describe, expect, it } from "vitest"
import { dec, toMoneyString, type Money } from "../../payroll/payroll.money"
import { phaseOf, planQuarters, splitRange, sumPlans, wholeYear, type QuarterPhase, type TargetRange } from "./target.plan"

/** Lakh, the way the business says it. */
const L = (lakh: number) => dec(lakh * 100_000)
const s = (m: Money | null) => (m === null ? null : toMoneyString(m))

const ALL_ENDED: QuarterPhase[] = ["ended", "ended", "ended", "ended"]
const IN_Q3: QuarterPhase[] = ["ended", "ended", "current", "upcoming"]

/** A range inside 2026, the way the form sends it. */
const R = (from: string, to: string): TargetRange => ({ from: `2026-${from}`, to: `2026-${to}` })

describe("splitting a target over a date range", () => {
  it("splits a whole year equally over four quarters, as before", () => {
    expect(splitRange(L(40), wholeYear(2026)).map(s)).toEqual(["1000000.00", "1000000.00", "1000000.00", "1000000.00"])
  })

  it("splits only over the quarters the range covers", () => {
    // Somebody who joins in July is not measured against January.
    expect(splitRange(L(20), R("07-01", "12-31")).map(s)).toEqual([null, null, "1000000.00", "1000000.00"])
  })

  it("gives the leftover paisa to the last quarter, so the parts add up to exactly the target", () => {
    expect(splitRange(dec("100.00"), R("04-01", "12-31")).map(s)).toEqual([null, "33.33", "33.33", "33.34"])
  })

  it("gives a part-covered quarter a share for the part of the quarter the range covers", () => {
    // 15 to 31 March is 17 of Q1's 90 days. Q2 and Q3 are whole. 1 to 31
    // October is 31 of Q4's 92 days. Weights: 17/90, 1, 1, 31/92.
    const parts = splitRange(dec("1000000.00"), R("03-15", "10-31"))
    const weights = [17 / 90, 1, 1, 31 / 92]
    const total = weights.reduce((a, b) => a + b, 0)
    expect(parts.map((p) => Math.round(Number(p!)))).toEqual(weights.map((w) => Math.round((1_000_000 * w) / total)))
    expect(parts.reduce<Money>((a, p) => a.plus(p!), dec(0)).toFixed(2)).toBe("1000000.00")
  })

  it("leaves a quarter after the range ends with no target", () => {
    expect(splitRange(L(20), R("01-01", "06-30")).map(s)).toEqual(["1000000.00", "1000000.00", null, null])
  })

  it("handles a range inside one quarter", () => {
    expect(splitRange(L(5), R("08-01", "08-31")).map(s)).toEqual([null, null, "500000.00", null])
  })
})

describe("which quarters have ended", () => {
  it("marks earlier quarters ended, this one current and later ones upcoming", () => {
    const now = { calendarYear: 2026, quarter: 3 }
    expect([1, 2, 3, 4].map((q) => phaseOf(2026, q, now))).toEqual(IN_Q3)
  })

  it("treats every quarter of a past year as ended, and of a future year as upcoming", () => {
    const now = { calendarYear: 2026, quarter: 1 }
    expect(phaseOf(2025, 4, now)).toBe("ended")
    expect(phaseOf(2027, 1, now)).toBe("upcoming")
  })
})

describe("planning the quarters", () => {
  it("has no target in any quarter when nobody set one, and still reports what was won", () => {
    const plan = planQuarters({ yearly: null, range: wholeYear(2026), won: [L(3), L(0), L(0), L(0)], phases: ALL_ENDED })

    expect(plan.map((q) => q.target)).toEqual([null, null, null, null])
    expect(s(plan[0].won)).toBe("300000.00")
    expect(plan[0].gap).toBeNull()
  })

  it("adds a quarter's shortfall to the next quarter's target", () => {
    // Q1 won 13L of 10L. Q2 won 7L of 10L, 3L short. Q3 is 10L + 3L.
    const plan = planQuarters({ yearly: L(40), range: wholeYear(2026), won: [L(13), L(7), L(0), L(0)], phases: IN_Q3 })

    expect(s(plan[2].carried)).toBe("300000.00")
    expect(s(plan[2].target)).toBe("1300000.00")
    // Q2 is over, so the carry is a fact, not a promise.
    expect(plan[2].carryPending).toBe(false)
  })

  it("does not lower the next quarter's target after a quarter beats its own", () => {
    const plan = planQuarters({ yearly: L(40), range: wholeYear(2026), won: [L(13), L(7), L(0), L(0)], phases: IN_Q3 })

    // The 3L extra in Q1 counts for the year only.
    expect(s(plan[1].carried)).toBe("0.00")
    expect(s(plan[1].target)).toBe("1000000.00")
  })

  it("reports a quarter that beat its target as a negative gap, and a short one as positive", () => {
    const plan = planQuarters({ yearly: L(40), range: wholeYear(2026), won: [L(13), L(7), L(0), L(0)], phases: IN_Q3 })

    expect(s(plan[0].gap)).toBe("-300000.00")
    expect(s(plan[1].gap)).toBe("300000.00")
  })

  it("carries a shortfall that already included a carry", () => {
    // Q1 short 4L, so Q2 is 14L. Q2 wins 10L, 4L short again, so Q3 is 14L.
    const plan = planQuarters({ yearly: L(40), range: wholeYear(2026), won: [L(6), L(10), L(0), L(0)], phases: IN_Q3 })

    expect(s(plan[1].target)).toBe("1400000.00")
    expect(s(plan[2].carried)).toBe("400000.00")
    expect(s(plan[2].target)).toBe("1400000.00")
  })

  it("does not carry the current quarter's shortfall until that quarter has ended", () => {
    const phases: QuarterPhase[] = ["ended", "current", "upcoming", "upcoming"]
    const plan = planQuarters({ yearly: L(40), range: wholeYear(2026), won: [L(10), L(2), L(0), L(0)], phases })

    // Q2 is 8L short so far, but it is not over. Q3 shows its own share and
    // says nothing is known yet about a carry.
    expect(plan[2].carried).toBeNull()
    expect(plan[2].carryPending).toBe(true)
    expect(s(plan[2].target)).toBe("1000000.00")
  })

  it("has no target before the start quarter and carries nothing into it", () => {
    const plan = planQuarters({ yearly: L(20), range: R("07-01", "12-31"), won: [L(1), L(0), L(4), L(0)], phases: ALL_ENDED })

    expect(plan[0].target).toBeNull()
    expect(plan[1].target).toBeNull()
    expect(plan[2].carried).toBeNull()
    // Nothing can ever be carried into the start quarter.
    expect(plan[2].carryPending).toBe(false)
    expect(s(plan[2].target)).toBe("1000000.00")
    // A win before the target started is still a win.
    expect(s(plan[0].won)).toBe("100000.00")
  })
})

describe("adding up the team", () => {
  it("adds each person's quarter targets, carries and wins", () => {
    const rahim = planQuarters({ yearly: L(40), range: wholeYear(2026), won: [L(7), L(0), L(0), L(0)], phases: IN_Q3 })
    const nasir = planQuarters({ yearly: L(20), range: wholeYear(2026), won: [L(5), L(5), L(0), L(0)], phases: IN_Q3 })

    const team = sumPlans([rahim, nasir], IN_Q3)

    // Rahim: Q1 10L, Q2 10L + 3L. Nasir: 5L every quarter, never short.
    expect(s(team[1].target)).toBe("1800000.00")
    expect(s(team[1].carried)).toBe("300000.00")
    expect(s(team[0].won)).toBe("1200000.00")
    expect(s(team[0].gap)).toBe("300000.00")
    // Q3 is still running, so what Q4 carries is not known yet.
    expect(team[3].carryPending).toBe(true)
  })

  it("keeps a quarter nobody has a target in as no target, not a target of zero", () => {
    const rahim = planQuarters({ yearly: L(20), range: R("07-01", "12-31"), won: [L(0), L(0), L(0), L(0)], phases: IN_Q3 })
    const nasir = planQuarters({ yearly: null, range: wholeYear(2026), won: [L(2), L(0), L(0), L(0)], phases: IN_Q3 })

    const team = sumPlans([rahim, nasir], IN_Q3)

    expect(team[0].target).toBeNull()
    expect(s(team[0].won)).toBe("200000.00")
    expect(s(team[2].target)).toBe("1000000.00")
  })

  it("returns four empty quarters for a team with nobody in it", () => {
    const team = sumPlans([], IN_Q3)

    expect(team.map((q) => q.quarter)).toEqual([1, 2, 3, 4])
    expect(team.map((q) => q.target)).toEqual([null, null, null, null])
    expect(team.map((q) => s(q.won))).toEqual(["0.00", "0.00", "0.00", "0.00"])
  })
})
