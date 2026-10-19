import { describe, expect, it } from "vitest"

import { dec } from "../../payroll/payroll.money"
import { coverageOf, daysBetween, parseQuarter, quarterDays, quarterLabel, quarterOfDay, summaryOf } from "./funnel.summary"

const day = (v: string) => new Date(`${v}T00:00:00.000Z`)

describe("quarters of a date-only value", () => {
  it("puts 31 March in Q1 and 1 April in Q2", () => {
    expect(quarterOfDay(day("2026-03-31"))).toEqual({ year: 2026, quarter: 1 })
    expect(quarterOfDay(day("2026-04-01"))).toEqual({ year: 2026, quarter: 2 })
  })

  it("labels and parses a quarter", () => {
    expect(quarterLabel(2026, 4)).toBe("Q4 2026")
    expect(parseQuarter("2026-Q3")).toEqual({ year: 2026, quarter: 3 })
  })

  it("gives the quarter as a half-open range of days", () => {
    expect(quarterDays(2026, 4)).toEqual({ gte: day("2026-10-01"), lt: day("2027-01-01") })
  })

  it("counts whole days, negative when the date has passed", () => {
    expect(daysBetween(day("2026-10-13"), day("2026-10-25"))).toBe(12)
    expect(daysBetween(day("2026-10-13"), day("2026-10-08"))).toBe(-5)
  })
})

describe("coverage", () => {
  it("is unknown with no target", () => {
    expect(coverageOf(dec("100"), null)).toEqual({ coverage: null, targetMet: false })
  })

  it("says the target is met when the gap is zero or less", () => {
    expect(coverageOf(dec("100"), dec("0"))).toEqual({ coverage: null, targetMet: true })
    expect(coverageOf(null, dec("-50"))).toEqual({ coverage: null, targetMet: true })
  })

  it("is open quoted over the gap, to one decimal", () => {
    expect(coverageOf(dec("1050000"), dec("500000"))).toEqual({ coverage: "2.1", targetMet: false })
  })

  it("is unknown when nothing open is priced", () => {
    expect(coverageOf(null, dec("500000"))).toEqual({ coverage: null, targetMet: false })
  })
})

describe("summaryOf", () => {
  it("never turns a missing target into zero", () => {
    expect(summaryOf({ year: 2026, quarter: 4, target: null, won: "0.00", gap: null, openQuoted: null, quoteMissingCount: 2 })).toEqual({
      quarterLabel: "Q4 2026", target: null, won: "0.00", gap: null, openQuoted: null, coverage: null, targetMet: false, quoteMissingCount: 2,
    })
  })

  it("fills coverage from the gap", () => {
    expect(summaryOf({ year: 2026, quarter: 4, target: "800000.00", won: "300000.00", gap: "500000.00", openQuoted: dec("1050000"), quoteMissingCount: 0 }))
      .toMatchObject({ openQuoted: "1050000.00", coverage: "2.1", targetMet: false })
  })
})
