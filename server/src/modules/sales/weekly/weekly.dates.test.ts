import { describe, expect, it, vi } from "vitest"

vi.mock("../../../config/env", () => ({ env: { APP_TIMEZONE: "Asia/Dhaka" } }))

import {
  dayLabelOf,
  deadlineDayOf,
  isInWeek,
  isLate,
  saturdayBefore,
  weekDays,
  weekStartOf,
} from "./weekly.dates"

const day = (value: string) => new Date(`${value}T00:00:00.000Z`)

// 2026-09-12 is a Saturday, 2026-09-13 a Sunday, 2026-09-17 a Thursday,
// 2026-09-18 a Friday.
const SUNDAY = day("2026-09-13")
const THURSDAY = day("2026-09-17")

const GENERAL = {
  id: "shift-1", name: "General", startTime: "09:00", endTime: "18:00", breakMinutes: 60,
  graceMinutes: 15, weeklyOffDays: [5], effectiveFrom: null, effectiveTo: null,
} as never

const holiday = (date: string, name: string, type = "GENERAL") => ({ date: day(date), name, type })

describe("weekStartOf", () => {
  it("is the Sunday of that week", () => {
    expect(weekStartOf(SUNDAY)).toEqual(SUNDAY)
    expect(weekStartOf(THURSDAY)).toEqual(SUNDAY)
  })

  it("puts the Saturday before with the week it opens, not the week that just ended", () => {
    // The team's own sheets run Saturday to Thursday (§26.2).
    expect(weekStartOf(day("2026-09-12"))).toEqual(SUNDAY)
  })

  it("puts the Friday between two weeks with the week that just ended", () => {
    expect(weekStartOf(day("2026-09-18"))).toEqual(SUNDAY)
  })
})

describe("weekDays", () => {
  it("is Sunday to Thursday", () => {
    expect(weekDays(SUNDAY)).toEqual([
      day("2026-09-13"), day("2026-09-14"), day("2026-09-15"), day("2026-09-16"), THURSDAY,
    ])
  })

  it("names the optional Saturday before it", () => {
    expect(saturdayBefore(SUNDAY)).toEqual(day("2026-09-12"))
  })
})

describe("isInWeek", () => {
  it("takes Saturday through Thursday", () => {
    expect(isInWeek(day("2026-09-12"), SUNDAY)).toBe(true)
    expect(isInWeek(SUNDAY, SUNDAY)).toBe(true)
    expect(isInWeek(THURSDAY, SUNDAY)).toBe(true)
  })

  it("refuses the Friday, and the days of other weeks", () => {
    expect(isInWeek(day("2026-09-18"), SUNDAY)).toBe(false)
    expect(isInWeek(day("2026-09-11"), SUNDAY)).toBe(false)
    expect(isInWeek(day("2026-09-20"), SUNDAY)).toBe(false)
  })
})

describe("deadlineDayOf", () => {
  it("is the Thursday", () => {
    expect(deadlineDayOf(SUNDAY, GENERAL, [])).toEqual(THURSDAY)
  })

  it("moves back when the Thursday is a holiday", () => {
    expect(deadlineDayOf(SUNDAY, GENERAL, [holiday("2026-09-17", "Eid-e-Milad")])).toEqual(
      day("2026-09-16")
    )
  })

  it("keeps moving back over two holidays in a row", () => {
    expect(
      deadlineDayOf(SUNDAY, GENERAL, [
        holiday("2026-09-17", "Eid day one"),
        holiday("2026-09-16", "Eid day two"),
      ])
    ).toEqual(day("2026-09-15"))
  })

  it("stays on the Thursday when the holiday is a working-day order", () => {
    expect(deadlineDayOf(SUNDAY, GENERAL, [holiday("2026-09-17", "Eid make-up", "WORKING_DAY")])).toEqual(
      THURSDAY
    )
  })

  it("falls back to the Thursday when the whole week is off", () => {
    // Nobody is marked late for a week nobody worked, and the week still has
    // a day to sit on.
    const everyDayOff = weekDays(SUNDAY).map((date, i) => ({ date, name: `Holiday ${i}`, type: "GENERAL" }))
    expect(deadlineDayOf(SUNDAY, GENERAL, everyDayOff)).toEqual(THURSDAY)
  })
})

describe("isLate", () => {
  it("is not late up to the end of the deadline day, office time", () => {
    // 23:30 Dhaka on the Thursday.
    expect(isLate(new Date("2026-09-17T17:30:00.000Z"), THURSDAY)).toBe(false)
  })

  it("is late once the office day has turned over", () => {
    // 00:30 Dhaka on the Friday, which is still 17 September in UTC.
    expect(isLate(new Date("2026-09-17T18:30:00.000Z"), THURSDAY)).toBe(true)
  })

  it("is not late when it was sent before the week even ended", () => {
    expect(isLate(new Date("2026-09-15T06:00:00.000Z"), THURSDAY)).toBe(false)
  })
})

describe("dayLabelOf", () => {
  const person = { shift: GENERAL, joiningDate: day("2020-01-01"), lastWorkingDay: null }

  it("has no label for an ordinary working day", () => {
    expect(dayLabelOf(THURSDAY, { ...person, holidays: [], leaves: [] })).toBeNull()
  })

  it("names a public holiday", () => {
    expect(
      dayLabelOf(THURSDAY, { ...person, holidays: [holiday("2026-09-17", "Eid-e-Milad")], leaves: [] })
    ).toEqual({ kind: "HOLIDAY", text: "Eid-e-Milad" })
  })

  it("labels the weekly off day", () => {
    expect(dayLabelOf(day("2026-09-18"), { ...person, holidays: [], leaves: [] })).toEqual({
      kind: "WEEKLY_OFF",
      text: "Weekly off",
    })
  })

  it("labels approved leave, and says which half when it is half a day", () => {
    const whole = [{ startDate: day("2026-09-14"), endDate: day("2026-09-15"), startSession: "FIRST_HALF", endSession: "SECOND_HALF" }]
    expect(dayLabelOf(day("2026-09-14"), { ...person, holidays: [], leaves: whole })).toEqual({
      kind: "LEAVE",
      text: "On leave",
    })

    const half = [{ startDate: day("2026-09-14"), endDate: day("2026-09-14"), startSession: "SECOND_HALF", endSession: "SECOND_HALF" }]
    expect(dayLabelOf(day("2026-09-14"), { ...person, holidays: [], leaves: half })).toEqual({
      kind: "LEAVE",
      text: "On leave (second half)",
    })
  })

  it("prefers the holiday's name over leave, because the office was shut anyway", () => {
    const leaves = [{ startDate: THURSDAY, endDate: THURSDAY, startSession: "FIRST_HALF", endSession: "SECOND_HALF" }]
    expect(
      dayLabelOf(THURSDAY, { ...person, holidays: [holiday("2026-09-17", "Eid-e-Milad")], leaves })
    ).toEqual({ kind: "HOLIDAY", text: "Eid-e-Milad" })
  })

  it("marks days outside the person's employment", () => {
    const joiner = { ...person, joiningDate: day("2026-09-16"), holidays: [], leaves: [] }
    expect(dayLabelOf(SUNDAY, joiner)).toEqual({ kind: "OUTSIDE_EMPLOYMENT", text: "Before joining" })

    const leaver = { ...person, lastWorkingDay: day("2026-09-15"), holidays: [], leaves: [] }
    expect(dayLabelOf(THURSDAY, leaver)).toEqual({ kind: "OUTSIDE_EMPLOYMENT", text: "After leaving" })
  })
})
