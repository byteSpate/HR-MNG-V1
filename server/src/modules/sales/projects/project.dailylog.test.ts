import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/env", () => ({ env: { APP_TIMEZONE: "Asia/Dhaka" } }))

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn() },
    project: { findFirst: vi.fn() },
    shift: { findMany: vi.fn() },
    holiday: { findMany: vi.fn() },
    leaveRequest: { findMany: vi.fn() },
    employee: { findMany: vi.fn() },
    projectDailyLog: { findMany: vi.fn() },
  },
}))
vi.mock("../../dealMoney/dealMoney.cost", () => ({ dealCostLineWhere: vi.fn().mockResolvedValue({}) }))

import prisma from "../../../config/prisma"
import { getProjectDailyLog } from "./project.dailylog"

const USER = { sub: "user-1", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const day = (v: string) => new Date(`${v}T00:00:00.000Z`)

/** Friday and Saturday off, as the seed's General shift is. */
const SHIFT = {
  id: "shift-1", name: "General", startTime: "09:00", endTime: "18:00", breakMinutes: 60,
  graceMinutes: 15, weeklyOffDays: [5, 6], effectiveFrom: null, effectiveTo: null,
}

const projectRow = (o: Record<string, unknown> = {}) => ({
  id: "prj-1", serial: "BS-PRJ-00001", name: "Core refresh", status: "IN_PROGRESS",
  managerEmployeeId: "emp-1", team: [], milestones: [], tasks: [], lines: [],
  ...o,
})

const TEAM = {
  team: [{ employeeId: "emp-2", responsibility: null, employee: { id: "emp-2", fullName: "Karim" } }],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  // Thursday 1 October 2026 in Dhaka. The week runs Sunday 27th to Thursday
  // the 1st, so the last day of the week is today.
  vi.setSystemTime(new Date("2026-10-01T06:00:00.000Z"))
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as any)
  vi.mocked(prisma.project.findFirst).mockResolvedValue(projectRow(TEAM) as any)
  vi.mocked(prisma.shift.findMany).mockResolvedValue([SHIFT] as any)
  vi.mocked(prisma.holiday.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
    { employeeId: "emp-2", startDate: day("2026-09-30"), endDate: day("2026-09-30"), startSession: "FIRST_HALF", endSession: "SECOND_HALF" },
  ] as any)
  vi.mocked(prisma.employee.findMany).mockResolvedValue([
    { id: "emp-2", fullName: "Karim", shiftId: "shift-1", joiningDate: day("2025-01-01"), lastWorkingDay: null },
  ] as any)
  vi.mocked(prisma.projectDailyLog.findMany).mockResolvedValue([
    { date: day("2026-09-28"), noWork: false, text: "Racked it", weeklyReport: { employeeId: "emp-2" } },
  ] as any)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("a Project's Daily Log for one week", () => {
  it("answers a week of days, starting on the Sunday", async () => {
    const view = await getProjectDailyLog("prj-1", {}, USER)
    expect(view.weekStart).toBe("2026-09-27")
    expect(view.days.map((d) => d.date)).toEqual([
      "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01",
    ])
  })

  it("has one row per team member on every day", async () => {
    const view = await getProjectDailyLog("prj-1", {}, USER)
    expect(view.days.every((d) => d.people.length === 1)).toBe(true)
    expect(view.days[0].people[0]).toMatchObject({ employeeId: "emp-2", fullName: "Karim" })
  })

  it("shows the line the person wrote", async () => {
    const view = await getProjectDailyLog("prj-1", {}, USER)
    expect(view.days[1].people[0]).toMatchObject({ text: "Racked it", noWork: false, missing: false })
  })

  it("marks a working day with no line as missing", async () => {
    const view = await getProjectDailyLog("prj-1", {}, USER)
    expect(view.days[2].people[0].missing).toBe(true)
  })

  it("never marks a day on leave as missing", async () => {
    const view = await getProjectDailyLog("prj-1", {}, USER)
    expect(view.days[3].people[0]).toMatchObject({ label: "On leave", missing: false })
  })

  it("never marks a holiday or a weekly off as missing, and says which it is", async () => {
    vi.mocked(prisma.holiday.findMany).mockResolvedValue([
      { date: day("2026-09-29"), name: "Eid", type: "PUBLIC_HOLIDAY" },
    ] as any)
    const view = await getProjectDailyLog("prj-1", { week: "2026-09-27" }, USER)
    expect(view.days[2].people[0]).toMatchObject({ label: "Eid", missing: false })
  })

  it("does not mark today missing before the day is over", async () => {
    // Today has come, so a Project in progress is already behind by this
    // measure: the person can still write the line.
    const view = await getProjectDailyLog("prj-1", {}, USER)
    expect(view.days[4].people[0].missing).toBe(true)
  })

  it("marks nothing missing once the Project is not in progress", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue(projectRow({ ...TEAM, status: "COMPLETED" }) as any)
    const view = await getProjectDailyLog("prj-1", {}, USER)
    expect(view.days.every((d) => d.people.every((p) => p.missing === false))).toBe(true)
  })

  it("says No work rather than no line when that is what was written", async () => {
    vi.mocked(prisma.projectDailyLog.findMany).mockResolvedValue([
      { date: day("2026-09-28"), noWork: true, text: null, weeklyReport: { employeeId: "emp-2" } },
    ] as any)
    const view = await getProjectDailyLog("prj-1", {}, USER)
    expect(view.days[1].people[0]).toMatchObject({ noWork: true, text: null, missing: false })
  })

  it("keeps two people apart: one wrote a line, the other did not", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "emp-2", fullName: "Karim", shiftId: "shift-1", joiningDate: day("2025-01-01"), lastWorkingDay: null },
      { id: "emp-3", fullName: "Nadia", shiftId: "shift-1", joiningDate: day("2025-01-01"), lastWorkingDay: null },
    ] as any)
    const view = await getProjectDailyLog("prj-1", {}, USER)
    const tuesday = view.days[2]
    expect(tuesday.people).toEqual([
      { employeeId: "emp-2", fullName: "Karim", label: null, noWork: false, text: null, missing: true },
      { employeeId: "emp-3", fullName: "Nadia", label: null, noWork: false, text: null, missing: true },
    ])
    expect(view.days[1].people[0].text).toBe("Racked it")
    expect(view.days[1].people[1].text).toBeNull()
  })

  it("asks for a week, not the whole history", async () => {
    await getProjectDailyLog("prj-1", {}, USER)
    expect(prisma.projectDailyLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        projectId: "prj-1",
        date: { gte: day("2026-09-27"), lte: day("2026-10-01") },
      }),
    }))
  })

  it("refuses a week that is not a date at all", async () => {
    await expect(getProjectDailyLog("prj-1", { week: "last week" }, USER))
      .rejects.toThrow("last week is not a date on the calendar")
  })

  it("refuses a Project the caller cannot see", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue(null as any)
    await expect(getProjectDailyLog("prj-1", {}, USER))
      .rejects.toThrow("That Project does not exist, or is not yours")
  })
})
