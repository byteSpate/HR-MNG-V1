import { describe, expect, it } from "vitest"

import { currentQuarter, quarterOf, quarterRange } from "./sales.quarters"

/**
 * APP_TIMEZONE is Asia/Dhaka: UTC+6, no daylight saving. Every boundary below
 * is therefore six hours before the UTC midnight of the same date, and that
 * offset is the whole point of these tests. A quarter is a run of local
 * calendar days, not a run of UTC ones.
 */
describe("sales quarters", () => {
  it("counts January to March as Q1, not the ledger's July year", () => {
    expect(quarterOf(new Date("2026-01-15T06:00:00.000Z"))).toBe(1)
    expect(quarterOf(new Date("2026-04-15T06:00:00.000Z"))).toBe(2)
    expect(quarterOf(new Date("2026-07-15T06:00:00.000Z"))).toBe(3)
    expect(quarterOf(new Date("2026-10-15T06:00:00.000Z"))).toBe(4)
  })

  it("starts a quarter at local midnight rather than UTC midnight", () => {
    expect(quarterRange(2026, 1).start.toISOString()).toBe("2025-12-31T18:00:00.000Z")
    expect(quarterRange(2026, 2).start.toISOString()).toBe("2026-03-31T18:00:00.000Z")
  })

  it("ends a quarter where the next one begins, with no gap and no overlap", () => {
    expect(quarterRange(2026, 1).end.toISOString()).toBe(quarterRange(2026, 2).start.toISOString())
    expect(quarterRange(2026, 3).end.toISOString()).toBe(quarterRange(2026, 4).start.toISOString())
  })

  it("keeps a deal closed late on 31 March in Q1", () => {
    // 23:59 in Dhaka on 31 March is already 17:59 UTC. Bucketing on the UTC
    // date would move this deal into Q2 and silently rewrite a past quarter.
    expect(quarterOf(new Date("2026-03-31T17:59:59.000Z"))).toBe(1)
    expect(quarterOf(new Date("2026-03-31T18:00:00.000Z"))).toBe(2)
  })

  it("runs Q4 into the next calendar year", () => {
    const q4 = quarterRange(2026, 4)
    expect(q4.start.toISOString()).toBe("2026-09-30T18:00:00.000Z")
    expect(q4.end.toISOString()).toBe("2026-12-31T18:00:00.000Z")
  })

  it("reports the quarter an instant falls in, with the local year", () => {
    // Local 1 January 2027, which is still 31 December 2026 in UTC.
    expect(currentQuarter(new Date("2026-12-31T18:00:00.000Z"))).toEqual({
      calendarYear: 2027,
      quarter: 1,
    })
  })

  it("refuses a quarter outside one to four", () => {
    expect(() => quarterRange(2026, 0)).toThrow(/quarter/i)
    expect(() => quarterRange(2026, 5)).toThrow(/quarter/i)
  })
})
