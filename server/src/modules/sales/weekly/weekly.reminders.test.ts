import { describe, expect, it, vi } from "vitest"

vi.mock("../../../config/env", () => ({ env: { APP_TIMEZONE: "Asia/Dhaka" } }))

import { whoNeedsReminding, type ReminderInput } from "./weekly.reminders"

const day = (value: string) => new Date(`${value}T00:00:00.000Z`)

// 2026-09-13 is a Sunday, 2026-09-16 a Wednesday, 2026-09-17 a Thursday.
const SUNDAY = day("2026-09-13")
const THURSDAY = day("2026-09-17")

const GENERAL = {
  id: "shift-1", name: "General", startTime: "09:00", endTime: "18:00", breakMinutes: 60,
  graceMinutes: 15, weeklyOffDays: [5], effectiveFrom: null, effectiveTo: null,
} as never

const person = (id: string, over: Record<string, unknown> = {}) => ({
  id, fullName: id === "emp-1" ? "Rahim" : "Karim", email: `${id}@demo.com`,
  shiftId: null, active: true, ...over,
})

const input = (over: Partial<ReminderInput> = {}): ReminderInput => ({
  today: THURSDAY,
  people: [person("emp-1")],
  shifts: [GENERAL],
  holidays: [],
  reports: [],
  alreadySent: new Set<string>(),
  ...over,
})

const ids = (rows: ReturnType<typeof whoNeedsReminding>) => rows.map((row) => row.employeeId)

describe("whoNeedsReminding", () => {
  it("reminds somebody who has not started this week's report, on the Thursday", () => {
    const rows = whoNeedsReminding(input())
    expect(ids(rows)).toEqual(["emp-1"])
    expect(rows[0]).toMatchObject({ weekStart: SUNDAY, deadlineDay: THURSDAY, fullName: "Rahim" })
  })

  it("reminds somebody whose week is still a draft", () => {
    const rows = whoNeedsReminding(
      input({ reports: [{ employeeId: "emp-1", weekStart: SUNDAY, status: "DRAFT" }] })
    )
    expect(ids(rows)).toEqual(["emp-1"])
  })

  it("leaves a submitted week alone", () => {
    const rows = whoNeedsReminding(
      input({ reports: [{ employeeId: "emp-1", weekStart: SUNDAY, status: "SUBMITTED" }] })
    )
    expect(rows).toEqual([])
  })

  it("says nothing on a day that is not the deadline", () => {
    expect(whoNeedsReminding(input({ today: day("2026-09-16") }))).toEqual([])
  })

  it("reminds on the Wednesday when the Thursday is a holiday", () => {
    const holidays = [{ date: THURSDAY, name: "Eid-e-Milad", type: "GENERAL" }]
    expect(ids(whoNeedsReminding(input({ today: day("2026-09-16"), holidays })))).toEqual(["emp-1"])
    // And not on the Thursday itself, which is nobody's working day.
    expect(whoNeedsReminding(input({ today: THURSDAY, holidays }))).toEqual([])
  })

  it("skips anyone who cannot be written to, or has already been reminded", () => {
    expect(whoNeedsReminding(input({ people: [person("emp-1", { email: null })] }))).toEqual([])
    expect(whoNeedsReminding(input({ people: [person("emp-1", { active: false })] }))).toEqual([])
    expect(whoNeedsReminding(input({ alreadySent: new Set(["emp-1"]) }))).toEqual([])
  })

  it("reminds each person against their own shift", () => {
    // A Monday-off shift still works Thursday, so both are due the same day.
    const showroom = { ...(GENERAL as never as Record<string, unknown>), id: "shift-2", weeklyOffDays: [1] } as never
    const rows = whoNeedsReminding(
      input({
        people: [person("emp-1"), person("emp-2", { shiftId: "shift-2" })],
        shifts: [GENERAL, showroom],
      })
    )
    expect(ids(rows)).toEqual(["emp-1", "emp-2"])
  })
})
