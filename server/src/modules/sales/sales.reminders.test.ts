import { describe, expect, it } from "vitest"

import { buildDailyDigests, isWorkingDay } from "./sales.reminders"

const day = (value: string) => new Date(`${value}T00:00:00.000Z`)

// 2026-09-17 is a Thursday, 2026-09-18 a Friday, 2026-09-19 a Saturday.
const GENERAL = {
  id: "shift-1", name: "General", startTime: "09:00", endTime: "18:00", breakMinutes: 60,
  graceMinutes: 15, weeklyOffDays: [5], effectiveFrom: null, effectiveTo: null,
} as any
const NO_FRIDAY_OFF = { ...GENERAL, id: "shift-2", name: "Showroom", weeklyOffDays: [1] } as any

const person = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, fullName: id === "emp-1" ? "Rahim" : "Karim", email: `${id}@demo.com`, shiftId: null, active: true,
  ...overrides,
})

const meeting = (overrides: Record<string, unknown> = {}) => ({
  id: "meeting-1", title: "Firewall walkthrough", scheduledAt: new Date("2026-09-17T04:00:00.000Z"),
  mode: "CUSTOMER_SITE", location: null, salesAccountName: "Bengal Group", attendeeIds: ["emp-1"],
  ...overrides,
})

const task = (overrides: Record<string, unknown> = {}) => ({
  id: "task-1", title: "Call back about the quote", dueOn: day("2026-09-17"), priority: "NORMAL",
  salesAccountName: "Bengal Group", assignedToEmployeeId: "emp-1",
  ...overrides,
})

const input = (overrides: Record<string, unknown> = {}) => ({
  today: day("2026-09-17"),
  people: [person("emp-1"), person("emp-2")],
  meetings: [meeting()],
  tasks: [task()],
  shifts: [GENERAL, NO_FRIDAY_OFF],
  holidays: [],
  alreadySent: new Set<string>(),
  ...overrides,
})

describe("isWorkingDay", () => {
  it("is off on the shift's weekly off day and on otherwise", () => {
    expect(isWorkingDay(day("2026-09-18"), GENERAL, [])).toBe(false)
    expect(isWorkingDay(day("2026-09-17"), GENERAL, [])).toBe(true)
  })

  it("is off on a company holiday, an optional one included, as the attendance calendar reads it", () => {
    expect(isWorkingDay(day("2026-09-17"), GENERAL, [{ date: day("2026-09-17"), type: "GENERAL" }])).toBe(false)
    expect(isWorkingDay(day("2026-09-17"), GENERAL, [{ date: day("2026-09-17"), type: "OPTIONAL" }])).toBe(false)
  })

  it("is a working day when a weekly off is declared a working day", () => {
    expect(isWorkingDay(day("2026-09-18"), GENERAL, [{ date: day("2026-09-18"), type: "WORKING_DAY" }])).toBe(true)
  })

  it("ignores holidays on other dates", () => {
    expect(isWorkingDay(day("2026-09-17"), GENERAL, [{ date: day("2026-09-16"), type: "GENERAL" }])).toBe(true)
  })
})

describe("buildDailyDigests", () => {
  it("gives each person one email with their meetings and their tasks together", () => {
    const digests = buildDailyDigests(input({
      tasks: [task(), task({ id: "task-2", assignedToEmployeeId: "emp-2" })],
    }) as any)

    expect(digests.map((d) => d.employeeId)).toEqual(["emp-1", "emp-2"])
    expect(digests[0]).toMatchObject({ email: "emp-1@demo.com", fullName: "Rahim" })
    expect(digests[0].meetings.map((m) => m.id)).toEqual(["meeting-1"])
    expect(digests[0].tasks.map((t) => t.id)).toEqual(["task-1"])
    expect(digests[1].meetings).toEqual([])
  })

  it("sends nothing to somebody with nothing on", () => {
    const digests = buildDailyDigests(input() as any)

    expect(digests.map((d) => d.employeeId)).toEqual(["emp-1"])
  })

  it("marks a task due before today as overdue, so what fell due on a day off still arrives", () => {
    const digests = buildDailyDigests(input({
      today: day("2026-09-19"),
      meetings: [],
      tasks: [task({ dueOn: day("2026-09-18") }), task({ id: "task-2", dueOn: day("2026-09-19") })],
    }) as any)

    expect(digests[0].tasks.map((t) => [t.id, t.overdue])).toEqual([["task-1", true], ["task-2", false]])
  })

  it("sends nothing on a person's weekly off day, but still to somebody working that day", () => {
    const digests = buildDailyDigests(input({
      today: day("2026-09-18"),
      people: [person("emp-1"), person("emp-2", { shiftId: "shift-2" })],
      tasks: [task(), task({ id: "task-2", assignedToEmployeeId: "emp-2" })],
    }) as any)

    expect(digests.map((d) => d.employeeId)).toEqual(["emp-2"])
  })

  it("sends nothing on a company holiday", () => {
    const digests = buildDailyDigests(input({
      holidays: [{ date: day("2026-09-17"), type: "GENERAL" }],
    }) as any)

    expect(digests).toEqual([])
  })

  it("skips somebody who already had today's email, so a restart never sends twice", () => {
    const digests = buildDailyDigests(input({ alreadySent: new Set(["emp-1"]) }) as any)

    expect(digests).toEqual([])
  })

  it("skips somebody who can no longer work in the hub, or has no address", () => {
    expect(buildDailyDigests(input({ people: [person("emp-1", { active: false })] }) as any)).toEqual([])
    expect(buildDailyDigests(input({ people: [person("emp-1", { email: null })] }) as any)).toEqual([])
  })
})
