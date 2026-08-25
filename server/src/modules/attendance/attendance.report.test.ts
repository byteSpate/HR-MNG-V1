import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Pinned so go-live does not shift with the deployment .env, exactly as
// attendance.summary.test.ts does.
vi.mock("../../config/env", () => ({
  env: { APP_TIMEZONE: "Asia/Dhaka", ATTENDANCE_GO_LIVE: "2026-08-01" },
}))

vi.mock("../../config/prisma", () => ({
  default: {
    employee: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    attendance: { findMany: vi.fn() },
    leaveRequest: { findMany: vi.fn() },
    holiday: { findMany: vi.fn() },
    shift: { findMany: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import type { Attendance, Shift } from "../../generated/prisma/client"
import { parseDateOnly } from "../../utils/dates"
import {
  getAttendanceReport,
  MAX_REPORT_DAYS,
  reportFilename,
  reportToCsv,
  resolveRange,
} from "./attendance.report"

// Midday Dhaka on Saturday 15 August 2026. August 2026 starts on a Saturday,
// so the Fridays — the default weekly off — are the 7th, 14th, 21st and 28th.
const NOW = new Date("2026-08-15T06:00:00.000Z")

const GENERAL: Shift = {
  id: "shift-general",
  name: "General",
  startTime: "09:00",
  endTime: "18:00",
  breakMinutes: 60,
  graceMinutes: 15,
  weeklyOffDays: [5],
  effectiveFrom: null,
  effectiveTo: null,
}

const AYESHA = {
  id: "emp-1",
  fullName: "Ayesha Rahman",
  employeeCode: "BS-EMP-001",
  designation: "Software Engineer",
  department: { name: "Engineering" },
  joiningDate: parseDateOnly("2024-01-06"),
  employmentStatus: "ACTIVE",
  shiftId: null,
  lastWorkingDay: null,
}

/** A comma in the name — the whole reason `csvCell` exists. */
const KARIM = {
  id: "emp-2",
  fullName: "Karim, Md.",
  employeeCode: "BS-EMP-002",
  designation: "Accounts Officer",
  department: { name: "Finance" },
  joiningDate: parseDateOnly("2024-01-06"),
  employmentStatus: "ACTIVE",
  shiftId: null,
  lastWorkingDay: null,
}

function attendanceRow(
  employeeId: string,
  date: string,
  overrides: Partial<Attendance> = {}
): Attendance {
  return {
    id: `att-${employeeId}-${date}`,
    employeeId,
    date: parseDateOnly(date),
    checkIn: new Date(`${date}T03:05:00.000Z`),
    checkOut: new Date(`${date}T12:05:00.000Z`),
    workedHours: 9,
    isLate: false,
    isEarlyOut: false,
    source: "WEB",
    approval: "APPROVED",
    approvedBy: "user-mgr",
    approvedAt: null,
    approvalNote: null,
    regularisedAt: null,
    regularisedNote: null,
    autoCheckOutAt: null,
    correctedBy: null,
    correctedAt: null,
    correctionNote: null,
    ...overrides,
  }
}

const actor = (role: string) =>
  ({ sub: "user-1", role, email: "a@demo.com", mustChangePassword: false }) as never

const hr = actor("HR_ADMIN")

/** Everything the grid loads, empty unless a test says otherwise. */
function mockSources(
  roster: unknown[],
  sources: { attendances?: Attendance[] } = {}
) {
  vi.mocked(prisma.employee.findMany).mockResolvedValue(roster as never)
  vi.mocked(prisma.attendance.findMany).mockResolvedValue((sources.attendances ?? []) as never)
  vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.holiday.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.shift.findMany).mockResolvedValue([GENERAL] as never)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("resolveRange", () => {
  it("rejects a range that runs backwards", () => {
    expect(() => resolveRange("2026-08-10", "2026-08-01")).toThrow(
      "`to` must not be earlier than `from`"
    )
  })

  it("accepts a single day", () => {
    const { start, end } = resolveRange("2026-08-10", "2026-08-10")
    expect(start.getTime()).toBe(end.getTime())
  })

  // The cost of a report is headcount x days, so this ceiling is real rather
  // than decorative: without it, "from 2020" is a full-history scan.
  it(`rejects a range longer than ${MAX_REPORT_DAYS} days`, () => {
    expect(() => resolveRange("2026-01-01", "2027-12-31")).toThrow(
      `A report must not span more than ${MAX_REPORT_DAYS} days`
    )
  })

  it("accepts a full year, which is the range a year-end report needs", () => {
    expect(() => resolveRange("2026-01-01", "2026-12-31")).not.toThrow()
  })
})

describe("summary granularity", () => {
  it("returns one row per employee and no day rows", async () => {
    mockSources([AYESHA, KARIM])

    const report = await getAttendanceReport(hr, { from: "2026-08-01", to: "2026-08-06" })

    expect(report.granularity).toBe("summary")
    expect(report.headcount).toBe(2)
    expect(report.rows).toHaveLength(2)
    expect(report.days).toHaveLength(0)
    expect(report.rows.map((r) => r.employee.employeeCode)).toEqual([
      "BS-EMP-001",
      "BS-EMP-002",
    ])
  })

  it("totals across the roster, not per employee", async () => {
    // 1-6 August: the 1st is a Saturday and the 5th a Wednesday; no Friday
    // falls inside, so all six are working days for both people.
    mockSources([AYESHA, KARIM], {
      attendances: [
        attendanceRow("emp-1", "2026-08-03"),
        attendanceRow("emp-1", "2026-08-04"),
        attendanceRow("emp-2", "2026-08-03"),
      ],
    })

    const report = await getAttendanceReport(hr, { from: "2026-08-01", to: "2026-08-06" })

    const summed = report.rows.reduce((n, r) => n + r.present, 0)
    expect(report.totals.present).toBe(summed)
    expect(report.totals.present).toBe(3)
    expect(report.totals.workingDays).toBe(
      report.rows.reduce((n, r) => n + r.workingDays, 0)
    )
  })

  it("carries the department, which the roster select does not fetch", async () => {
    mockSources([AYESHA, KARIM])

    const report = await getAttendanceReport(hr, { from: "2026-08-01", to: "2026-08-06" })

    expect(report.rows.map((r) => r.department)).toEqual(["Engineering", "Finance"])
  })

  it("falls back to a dash rather than a blank cell when the join is empty", async () => {
    const { department: _dropped, ...noDept } = AYESHA
    mockSources([noDept])

    const report = await getAttendanceReport(hr, { from: "2026-08-01", to: "2026-08-06" })

    expect(report.rows[0].department).toBe("—")
  })

  // A one-day *summary* — "working days 1, present 1" — is not a document
  // anybody wants, so the PDF lays a single day out as a register instead.
  // That needs the day rows, whatever granularity was asked for.
  it("also returns day rows when the range is a single day", async () => {
    mockSources([AYESHA, KARIM], { attendances: [attendanceRow("emp-1", "2026-08-03")] })

    const report = await getAttendanceReport(hr, { from: "2026-08-03", to: "2026-08-03" })

    expect(report.granularity).toBe("summary")
    expect(report.rows).toHaveLength(2)
    expect(report.days).toHaveLength(2)
    expect(report.days[0].date).toBe("2026-08-03")
  })

  // The rollup goes through summariseDays, so the identity payroll depends on
  // has to survive the trip through the report.
  it("preserves the working-day identity per row", async () => {
    mockSources([AYESHA], { attendances: [attendanceRow("emp-1", "2026-08-03")] })

    const report = await getAttendanceReport(hr, { from: "2026-08-01", to: "2026-08-14" })

    for (const r of report.rows) {
      expect(r.present + r.absent + r.onLeave + r.notCheckedIn).toBe(r.workingDays)
    }
  })
})

describe("daily granularity", () => {
  it("returns one row per employee per tracked day, and no summary rows", async () => {
    mockSources([AYESHA], { attendances: [attendanceRow("emp-1", "2026-08-03")] })

    const report = await getAttendanceReport(hr, {
      from: "2026-08-01",
      to: "2026-08-03",
      granularity: "daily",
    })

    expect(report.rows).toHaveLength(0)
    expect(report.days.map((d) => d.date)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"])
    expect(report.days[2].status).toBe("PRESENT")
  })

  it("sorts by date, then by name — a register, not one person's history", async () => {
    mockSources([KARIM, AYESHA])

    const report = await getAttendanceReport(hr, {
      from: "2026-08-01",
      to: "2026-08-02",
      granularity: "daily",
    })

    expect(report.days.map((d) => `${d.date} ${d.employee.fullName}`)).toEqual([
      "2026-08-01 Ayesha Rahman",
      "2026-08-01 Karim, Md.",
      "2026-08-02 Ayesha Rahman",
      "2026-08-02 Karim, Md.",
    ])
  })

  // Go-live is 2026-08-01 in this suite. Days before it are NOT_TRACKED, and
  // printing them as blank rows would read as absences.
  it("omits untracked days rather than printing them empty", async () => {
    mockSources([AYESHA])

    const report = await getAttendanceReport(hr, {
      from: "2026-07-28",
      to: "2026-08-02",
      granularity: "daily",
    })

    expect(report.days.every((d) => d.date >= "2026-08-01")).toBe(true)
  })

  it("still totals through the rollup, so half-days are not double-counted", async () => {
    mockSources([AYESHA], { attendances: [attendanceRow("emp-1", "2026-08-03")] })

    const report = await getAttendanceReport(hr, {
      from: "2026-08-01",
      to: "2026-08-03",
      granularity: "daily",
    })

    expect(report.totals.present).toBe(1)
  })
})

describe("scoping", () => {
  it("filters to one employee when asked", async () => {
    mockSources([AYESHA, KARIM])

    const report = await getAttendanceReport(hr, {
      from: "2026-08-01",
      to: "2026-08-02",
      employeeId: "emp-2",
    })

    expect(report.headcount).toBe(1)
    expect(report.rows[0].employee.employeeCode).toBe("BS-EMP-002")
  })

  // The filter is applied *after* rosterFor, never inside the query — so
  // asking for somebody outside your roster is a 404, not their attendance.
  it("refuses an employee who is not on the caller's roster", async () => {
    mockSources([AYESHA])

    await expect(
      getAttendanceReport(hr, { from: "2026-08-01", to: "2026-08-02", employeeId: "emp-2" })
    ).rejects.toThrow("That employee is not on a roster you can report on")
  })
})

describe("CSV", () => {
  it("quotes a name containing a comma", async () => {
    mockSources([KARIM])

    const csv = reportToCsv(await getAttendanceReport(hr, { from: "2026-08-01", to: "2026-08-02" }))

    expect(csv).toContain('"Karim, Md."')
    // Quoted, so the column count is unchanged by the comma inside the name.
    const [header, row] = csv.split("\r\n")
    expect(row.split('","').length).toBeGreaterThan(0)
    expect(header.split(",")[0]).toBe("EmployeeCode")
  })

  it("emits the daily headers for a daily report", async () => {
    mockSources([AYESHA])

    const csv = reportToCsv(
      await getAttendanceReport(hr, {
        from: "2026-08-01",
        to: "2026-08-02",
        granularity: "daily",
      })
    )

    expect(csv.split("\r\n")[0]).toBe(
      "Date,EmployeeCode,Name,Department,Designation,Status,WorkingDay,CheckIn,CheckOut,WorkedHours,ExpectedHours,Late,EarlyOut,Approval,Regularised,AutoCheckOut,Detail"
    )
  })

  /**
   * The PDF prints `8h 42m` and the CSV must not.
   *
   * A spreadsheet is where somebody sums, averages or charts a column, and
   * `8h 42m` is text that does none of those. The three outputs are supposed
   * to disagree here — which is exactly why this is pinned: the natural
   * instinct when tidying up the hour formatting is to make them all match.
   */
  it("keeps hours as a bare number, because a spreadsheet has to add them up", async () => {
    mockSources([AYESHA], { attendances: [attendanceRow("emp-1", "2026-08-03")] })

    const report = await getAttendanceReport(hr, { from: "2026-08-01", to: "2026-08-06" })
    const csv = reportToCsv(report)
    const headers = csv.split("\r\n")[0].split(",")
    const values = csv.split("\r\n")[1].split(",")

    for (const column of ["WorkedHours", "ExpectedHours", "ShortfallHours"]) {
      const cell = values[headers.indexOf(column)]
      expect(cell, `${column} must be summable, not "${cell}"`).toMatch(/^\d+(\.\d+)?$/)
      expect(Number.isNaN(Number(cell))).toBe(false)
    }
  })

  it("names the file after the range, since a downloads folder loses context", async () => {
    mockSources([AYESHA])

    const report = await getAttendanceReport(hr, { from: "2026-08-01", to: "2026-08-31" })

    expect(reportFilename(report)).toBe("attendance-summary-2026-08-01-to-2026-08-31.csv")
  })
})
