import { describe, expect, it, vi } from "vitest"

vi.mock("../../../config/env", () => ({ env: { APP_TIMEZONE: "Asia/Dhaka" } }))

import {
  meetingSaturdayFor,
  monthYearOf,
  nextSaturdayFrom,
  recentChangeSince,
  weekReviewedBy,
} from "./funnel.dates"

const day = (value: string) => new Date(`${value}T00:00:00.000Z`)
const iso = (value: Date) => value.toISOString().slice(0, 10)

// The owner's own worked example (§27.1, and the grilling on 2026-09-17):
// "suppose the week runs from September 5 to September 10. On September 10 the
// employee submits their Weekly Report. Then on September 12 there is a Funnel
// Meeting where the Funnel is reviewed."
//
// 2026-09-05 is a Saturday, 06 a Sunday, 10 a Thursday, 12 a Saturday.
const SAT_05 = day("2026-09-05")
const SUN_06 = day("2026-09-06")
const THU_10 = day("2026-09-10")
const SAT_12 = day("2026-09-12")

describe("weekReviewedBy", () => {
  it("reviews the week that just ended, for the owner's worked example", () => {
    // Held Saturday 12 Sep, reviewing the week whose Sunday is 6 Sep.
    expect(iso(weekReviewedBy(SAT_12))).toBe("2026-09-06")
  })

  it("is the week before the one the meeting's own Saturday opens", () => {
    // weekStartOf treats a Saturday as opening the NEXT week (§26.2), so the
    // reviewed week is that one less seven days. This test exists because
    // getting it wrong is off by exactly one week and looks right.
    expect(iso(weekReviewedBy(day("2026-09-19")))).toBe("2026-09-13")
    expect(iso(weekReviewedBy(day("2026-09-26")))).toBe("2026-09-20")
  })

  it("still names the last finished week when the meeting slips to a weekday", () => {
    // "We did last week's funnel on the Monday" is a real thing. Monday 14 Sep
    // still reviews the week that ended Thursday 10 Sep.
    expect(iso(weekReviewedBy(day("2026-09-14")))).toBe("2026-09-06")
    expect(iso(weekReviewedBy(day("2026-09-17")))).toBe("2026-09-06")
  })

  it("returns a date-only value at UTC midnight", () => {
    const result = weekReviewedBy(new Date("2026-09-12T11:30:00.000Z"))
    expect(result.toISOString()).toBe("2026-09-06T00:00:00.000Z")
  })
})

describe("meetingSaturdayFor", () => {
  it("is the Saturday after the reviewed week's Thursday", () => {
    expect(iso(meetingSaturdayFor(SUN_06))).toBe("2026-09-12")
  })

  it("round-trips with weekReviewedBy", () => {
    for (const weekStart of [SUN_06, day("2026-09-13"), day("2026-09-20")]) {
      expect(iso(weekReviewedBy(meetingSaturdayFor(weekStart)))).toBe(iso(weekStart))
    }
  })
})

describe("nextSaturdayFrom", () => {
  it("is a week out when asked on the meeting's own Saturday", () => {
    // An action item given at Saturday's review is due by the NEXT review, not
    // the same day it was handed out (§27.13).
    expect(iso(nextSaturdayFrom(SAT_12))).toBe("2026-09-19")
  })

  it("is the coming Saturday from any other day", () => {
    expect(iso(nextSaturdayFrom(SUN_06))).toBe("2026-09-12")
    expect(iso(nextSaturdayFrom(THU_10))).toBe("2026-09-12")
    expect(iso(nextSaturdayFrom(day("2026-09-11")))).toBe("2026-09-12")
  })

  it("returns a date-only value, whatever time it is asked", () => {
    expect(nextSaturdayFrom(new Date("2026-09-10T18:45:00.000Z")).toISOString()).toBe(
      "2026-09-12T00:00:00.000Z"
    )
  })
})

describe("recentChangeSince", () => {
  it("is seven days before the instant given", () => {
    const now = new Date("2026-09-19T09:00:00.000Z")
    expect(recentChangeSince(now).toISOString()).toBe("2026-09-12T09:00:00.000Z")
  })

  it("keeps the time of day, because it filters instants and not dates", () => {
    const now = new Date("2026-09-19T23:59:59.000Z")
    expect(recentChangeSince(now).toISOString()).toBe("2026-09-12T23:59:59.000Z")
  })
})

describe("monthYearOf", () => {
  it("prints the month and the year, and never a day", () => {
    // §27.6: a closing date is only ever as precise as the month. Printing a
    // day number reads as a promise nobody made.
    expect(monthYearOf(day("2026-10-15"))).toBe("Oct 2026")
    expect(monthYearOf(day("2026-01-01"))).toBe("Jan 2026")
    expect(monthYearOf(day("2027-12-31"))).toBe("Dec 2027")
  })

  it("is empty for a deal with no closing date", () => {
    // Not "—" and not "Unknown": the cell is simply blank, as the sheet's is.
    expect(monthYearOf(null)).toBe("")
  })

  it("reads the month off UTC, not off the host's locale", () => {
    // A date-only value is UTC midnight. On a host behind UTC, reading it
    // locally would report the previous month for every first of the month.
    expect(monthYearOf(new Date("2026-03-01T00:00:00.000Z"))).toBe("Mar 2026")
  })
})

describe("the reviewed week and the weekly report agree", () => {
  it("names the same week the Weekly Report was submitted for", () => {
    // The funnel reviews the week whose report landed on Thursday. If these
    // two ever disagree the admin reviews one week against another week's
    // report, which is the single worst failure this module can have.
    expect(iso(weekReviewedBy(SAT_12))).toBe(iso(SUN_06))
    expect(THU_10.getTime()).toBeGreaterThan(SUN_06.getTime())
    expect(SAT_05.getTime()).toBeLessThan(SUN_06.getTime())
  })
})
