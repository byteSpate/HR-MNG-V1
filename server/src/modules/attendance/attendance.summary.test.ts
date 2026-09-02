import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Pinned so the go-live assertions do not shift with the deployment .env.
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
import type { Attendance, Holiday, Shift } from "../../generated/prisma/client"
import { parseDateOnly } from "../../utils/dates"
import { resolveGrid } from "./attendance.grid"
import { getDailySummary, getMonthlySummary, summariseDays } from "./attendance.summary"
import type { AttendanceDay, EmployeeRef, GridEmployee } from "./attendance.types"

// Midday Dhaka on Saturday 15 August 2026. August 2026 starts on a Saturday,
// so the Fridays are the 7th, 14th, 21st and 28th.
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

const REF: EmployeeRef = {
  id: "emp-1",
  fullName: "Ayesha Rahman",
  employeeCode: "BS-EMP-DEMO",
  designation: "Software Engineer",
}

const ROSTER_ROW = {
  ...REF,
  joiningDate: parseDateOnly("2024-01-06"),
  employmentStatus: "ACTIVE",
  shiftId: null,
  lastWorkingDay: null,
}

const gridEmployee: GridEmployee = {
  id: "emp-1",
  joiningDate: parseDateOnly("2024-01-06"),
  employmentStatus: "ACTIVE",
  shiftId: null,
  lastWorkingDay: null,
}

function attendanceRow(date: string, overrides: Partial<Attendance> = {}): Attendance {
  return {
    id: `att-${date}`,
    employeeId: "emp-1",
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

const holiday = (date: string, name: string, type: Holiday["type"] = "GENERAL"): Holiday => ({
  id: `hol-${date}-${name}`,
  name,
  date: parseDateOnly(date),
  type,
})

/** Builds August 2026 for one employee and rolls it up. */
function august(
  sources: {
    attendances?: Attendance[]
    leaves?: Parameters<typeof resolveGrid>[3]["leaves"]
    holidays?: Holiday[]
    shifts?: Shift[]
  } = {},
  employee: GridEmployee = gridEmployee
) {
  const from = parseDateOnly("2026-08-01")
  const to = parseDateOnly("2026-08-31")
  const grid = resolveGrid([employee], from, to, {
    attendances: sources.attendances ?? [],
    leaves: sources.leaves ?? [],
    holidays: sources.holidays ?? [],
    shifts: sources.shifts ?? [GENERAL],
  })
  return summariseDays(REF, grid.get(employee.id) ?? [], 8, 2026)
}

const actor = (role: string) =>
  ({ sub: "user-1", role, email: "a@demo.com", mustChangePassword: false }) as never

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("the monthly working-day identity", () => {
  it("holds for a plain month", () => {
    // present + absent + onLeave + notCheckedIn === workingDays.
    // Payroll divides by workingDays, so if this is wrong it is wrong in
    // money. The three-term version in the original spec only holds once a
    // month is complete — mid-month, the rest is NOT_CHECKED_IN.
    const s = august()
    expect(s.present + s.absent + s.onLeave + s.notCheckedIn).toBe(s.workingDays)
  })

  it("holds in a month with a holiday, a worked Friday, and leave", () => {
    const s = august({
      attendances: [attendanceRow("2026-08-07"), attendanceRow("2026-08-03")],
      holidays: [holiday("2026-08-05", "July Uprising Day")],
      leaves: [
        {
          employeeId: "emp-1",
          startDate: parseDateOnly("2026-08-10"),
          endDate: parseDateOnly("2026-08-11"),
          startSession: "FIRST_HALF",
          endSession: "SECOND_HALF",
          leaveType: { name: "Annual", isPaid: true },
        },
      ],
    })
    expect(s.present + s.absent + s.onLeave + s.notCheckedIn).toBe(s.workingDays)
    expect(s.onLeave).toBe(2)
    // The Friday that was worked sits outside the identity entirely.
    expect(s.workedOnOffDays).toBe(1)
    expect(s.present).toBe(1)
  })

  // The split payroll's deduction rule needs: lopDays = absent +
  // onUnpaidLeave. Charging paid leave would be a straightforward
  // underpayment, and the two are indistinguishable in `onLeave` alone.
  it("splits onLeave into paid and unpaid, and they sum to the total", () => {
    const s = august({
      leaves: [
        {
          employeeId: "emp-1",
          startDate: parseDateOnly("2026-08-10"),
          endDate: parseDateOnly("2026-08-11"),
          startSession: "FIRST_HALF",
          endSession: "SECOND_HALF",
          leaveType: { name: "Sick", isPaid: true },
        },
        {
          employeeId: "emp-1",
          startDate: parseDateOnly("2026-08-12"),
          endDate: parseDateOnly("2026-08-13"),
          startSession: "FIRST_HALF",
          endSession: "SECOND_HALF",
          leaveType: { name: "Leave without pay", isPaid: false },
        },
      ],
    })
    expect(s.onPaidLeave).toBe(2)
    expect(s.onUnpaidLeave).toBe(2)
    expect(s.onPaidLeave + s.onUnpaidLeave).toBe(s.onLeave)
  })

  it("keeps the four-term identity intact across the split", () => {
    // The identity payroll's denominator depends on. The split must not
    // disturb it, which is why onLeave stays the total.
    const s = august({
      leaves: [
        {
          employeeId: "emp-1",
          startDate: parseDateOnly("2026-08-10"),
          endDate: parseDateOnly("2026-08-11"),
          startSession: "FIRST_HALF",
          endSession: "SECOND_HALF",
          leaveType: { name: "Leave without pay", isPaid: false },
        },
      ],
    })
    expect(s.present + s.absent + s.onLeave + s.notCheckedIn).toBe(s.workingDays)
  })

  it("counts unpaid leave in neither present nor absent", () => {
    // Were unpaid leave to fall through to ABSENT, payroll would deduct for
    // it twice: once as absence and once as unpaid leave.
    const withUnpaid = august({
      leaves: [
        {
          employeeId: "emp-1",
          startDate: parseDateOnly("2026-08-10"),
          endDate: parseDateOnly("2026-08-11"),
          startSession: "FIRST_HALF",
          endSession: "SECOND_HALF",
          leaveType: { name: "Leave without pay", isPaid: false },
        },
      ],
    })
    const plain = august()
    expect(withUnpaid.present).toBe(plain.present)
    expect(withUnpaid.absent).toBe(plain.absent - 2)
    expect(withUnpaid.onUnpaidLeave).toBe(2)
  })

  it("holds with a WORKING_DAY override, which adds a working day", () => {
    const plain = august()
    const overridden = august({
      holidays: [holiday("2026-08-07", "Weekly holiday cancelled", "WORKING_DAY")],
    })
    expect(overridden.workingDays).toBe(plain.workingDays + 1)
    expect(overridden.weeklyOffs).toBe(plain.weeklyOffs - 1)
    expect(
      overridden.present + overridden.absent + overridden.onLeave + overridden.notCheckedIn
    ).toBe(overridden.workingDays)
  })

  it("holds for a mid-month joiner, who has no days before they started", () => {
    const s = august({}, { ...gridEmployee, joiningDate: parseDateOnly("2026-08-17") })
    expect(s.present + s.absent + s.onLeave + s.notCheckedIn).toBe(s.workingDays)
    expect(s.absent).toBe(0)
    expect(s.workingDays).toBeLessThan(august().workingDays)
  })

  it("holds over the tracked part of a month straddling go-live", () => {
    // Go-live is 2026-08-01, so July is NOT_TRACKED and contributes nothing.
    const from = parseDateOnly("2026-07-15")
    const to = parseDateOnly("2026-08-31")
    const grid = resolveGrid([gridEmployee], from, to, {
      attendances: [],
      leaves: [],
      holidays: [],
      shifts: [GENERAL],
    })
    const s = summariseDays(REF, grid.get("emp-1") ?? [], 8, 2026)
    expect(s.present + s.absent + s.onLeave + s.notCheckedIn).toBe(s.workingDays)
    expect(s.workingDays).toBe(august().workingDays)
  })

  it("does not count a holiday landing on the weekly off twice", () => {
    const plain = august()
    const s = august({ holidays: [holiday("2026-08-07", "A Friday holiday")] })
    expect(s.holidays).toBe(1)
    expect(s.weeklyOffs).toBe(plain.weeklyOffs - 1)
    expect(s.workingDays).toBe(plain.workingDays)
  })
})

describe("hours", () => {
  it("compares elapsed against elapsed, with the break inside both", () => {
    const s = august({ attendances: [attendanceRow("2026-08-03")] })
    expect(s.workedHours).toBe(9)
    // 09:00-18:00 is a 9-hour expectation, so a full day has no shortfall.
    expect(s.shortfallHours).toBe(0)
  })

  it("records a shortfall for someone who leaves at 13:00", () => {
    const s = august({
      attendances: [
        attendanceRow("2026-08-03", {
          checkOut: new Date("2026-08-03T07:00:00.000Z"),
          workedHours: 4,
          isEarlyOut: true,
        }),
      ],
    })
    // Not an absence, but not a full day either — this is what
    // attendance-based deductions will consume.
    expect(s.shortfallHours).toBe(5)
    expect(s.earlyOut).toBe(1)
  })

  it("excludes a missing check-out from summed hours rather than guessing it", () => {
    const s = august({
      attendances: [
        attendanceRow("2026-08-03", { checkOut: null, workedHours: null }),
        attendanceRow("2026-08-04"),
      ],
    })
    expect(s.missingCheckOut).toBe(1)
    expect(s.workedHours).toBe(9)
    // Still present — the person was there, the record is just incomplete.
    expect(s.present).toBe(2)
    // And it contributes no phantom shortfall.
    expect(s.shortfallHours).toBe(0)
  })
})

describe("approval counters", () => {
  it("separates decided records from those still waiting", () => {
    const s = august({
      attendances: [
        attendanceRow("2026-08-03", { approval: "APPROVED", approvedBy: "user-mgr" }),
        attendanceRow("2026-08-04", { approval: "PENDING" }),
        attendanceRow("2026-08-06", { approval: "APPROVED", approvedBy: "user-hr" }),
      ],
    })
    expect(s.approved).toBe(2)
    expect(s.pendingApproval).toBe(1)
    expect(s.present).toBe(3)
  })

  it("drops a rejected record out of present and back to absent", () => {
    const s = august({
      attendances: [attendanceRow("2026-08-03", { approval: "REJECTED" })],
    })
    expect(s.present).toBe(0)
    // A rejected record is not an attendance, so that working day is absent.
    expect(s.absent).toBeGreaterThan(0)
    // …but it is still reported, because "this person had a claim rejected"
    // is exactly what a reviewer needs to see.
    expect(s.rejected).toBe(1)
  })

  it("keeps a rejected record's hours and flags out of every statistic", () => {
    // Otherwise payroll is handed time that was explicitly refused.
    const s = august({
      attendances: [
        attendanceRow("2026-08-03", { approval: "REJECTED", isLate: true, workedHours: 9 }),
      ],
    })
    expect(s.workedHours).toBe(0)
    expect(s.late).toBe(0)
    expect(s.shortfallHours).toBe(0)
    expect(s.missingCheckOut).toBe(0)
  })

  it("counts regularised records", () => {
    const s = august({
      attendances: [
        attendanceRow("2026-08-03", { regularisedAt: new Date("2026-08-04T04:00:00Z") }),
      ],
    })
    expect(s.regularised).toBe(1)
  })
})

describe("roster scoping", () => {
  function stubGrid() {
    vi.mocked(prisma.attendance.findMany).mockResolvedValue([])
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([])
    vi.mocked(prisma.holiday.findMany).mockResolvedValue([])
    vi.mocked(prisma.shift.findMany).mockResolvedValue([GENERAL])
  }

  it("gives an employee a one-row roster rather than a 403", async () => {
    // Keeps the route shape uniform across roles.
    vi.mocked(prisma.employee.findUnique)
      .mockResolvedValueOnce({ id: "emp-1" } as never)
      .mockResolvedValueOnce(ROSTER_ROW as never)
    stubGrid()

    const rows = await getMonthlySummary(actor("EMPLOYEE"), 8, 2026)
    expect(rows).toHaveLength(1)
    expect(rows[0].employee.id).toBe("emp-1")
  })

  it("gives a manager themselves plus their direct reports", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-1" } as never)
    vi.mocked(prisma.employee.findMany).mockResolvedValue([ROSTER_ROW] as never)
    stubGrid()

    await getMonthlySummary(actor("REPORTING_MANAGER"), 8, 2026)
    expect(prisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ id: "emp-1" }, { reportingManagerId: "emp-1" }],
        }),
      })
    )
  })

  it.each(["HR_ADMIN", "SUPER_ADMIN", "FINANCE_OFFICER"])(
    "gives %s everyone still on the books",
    async (role) => {
      vi.mocked(prisma.employee.findMany).mockResolvedValue([ROSTER_ROW] as never)
      stubGrid()

      await getMonthlySummary(actor(role), 8, 2026)
      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] } },
        })
      )
    }
  )
})

describe("daily summary", () => {
  beforeEach(() => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([ROSTER_ROW] as never)
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([])
    vi.mocked(prisma.holiday.findMany).mockResolvedValue([])
    vi.mocked(prisma.shift.findMany).mockResolvedValue([GENERAL])
    vi.mocked(prisma.attendance.findMany).mockResolvedValue([])
  })

  it("defaults to the office-local today", async () => {
    const summary = await getDailySummary(actor("HR_ADMIN"))
    expect(summary.date).toBe("2026-08-15")
  })

  it("reports a not-yet-checked-in working day as such, not as absent", async () => {
    const summary = await getDailySummary(actor("HR_ADMIN"))
    expect(summary.totals.notCheckedIn).toBe(1)
    expect(summary.totals.absent).toBe(0)
  })

  it("flags a check-in that overlaps approved leave instead of blocking it", async () => {
    // Allowed, not blocked: a 409 would leave somebody who genuinely came
    // in unable to record real work.
    vi.mocked(prisma.attendance.findMany).mockResolvedValue([attendanceRow("2026-08-15")] as never)
    vi.mocked(prisma.leaveRequest.findMany)
      .mockResolvedValueOnce([
        {
          employeeId: "emp-1",
          startDate: parseDateOnly("2026-08-14"),
          endDate: parseDateOnly("2026-08-16"),
          startSession: "FIRST_HALF",
          endSession: "SECOND_HALF",
          leaveType: { name: "Annual", isPaid: true },
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          employeeId: "emp-1",
          startDate: parseDateOnly("2026-08-14"),
          endDate: parseDateOnly("2026-08-16"),
          startSession: "FIRST_HALF",
          endSession: "SECOND_HALF",
        },
      ] as never)

    const summary = await getDailySummary(actor("HR_ADMIN"), "2026-08-15")
    expect(summary.totals.present).toBe(1)
    expect(summary.conflicts).toEqual([
      { employeeId: "emp-1", fullName: "Ayesha Rahman", reason: "CHECKED_IN_WHILE_ON_LEAVE" },
    ])
  })
})

describe("half-day leave in the monthly summary", () => {
  const REF_H: EmployeeRef = {
    id: "emp-1",
    fullName: "Ayesha Rahman",
    employeeCode: "BS-EMP-00001",
    designation: "Engineer",
  }

  const day = (over: Partial<AttendanceDay> = {}): AttendanceDay => ({
    date: "2026-08-10",
    status: "PRESENT",
    isWorkingDay: true,
    isOffDay: false,
    isHoliday: false,
    isWeeklyOff: false,
    checkIn: null,
    checkOut: null,
    workedHours: null,
    expectedHours: 4.5,
    isLate: false,
    isEarlyOut: false,
    approval: null,
    source: null,
    detail: null,
    leaveIsPaid: null,
    leaveFraction: 0.5,
    leaveStartSession: "FIRST_HALF",
    unservedStatus: null,
    regularised: false,
    autoCheckOut: false,
    corrected: false,
    attendanceId: "att-1",
    ...over,
  })

  const noShow = (over: Partial<AttendanceDay> = {}) =>
    day({ status: "ON_LEAVE", attendanceId: null, unservedStatus: "ABSENT", ...over })

  it("splits a worked half day between present and onLeave", () => {
    const s = summariseDays(REF_H, [day()], 8, 2026)
    expect(s.present).toBe(0.5)
    expect(s.onLeave).toBe(0.5)
    expect(s.workingDays).toBe(1)
  })

  it("counts the unserved half as absent on a past no-show", () => {
    const s = summariseDays(REF_H, [noShow()], 8, 2026)
    expect(s.onLeave).toBe(0.5)
    expect(s.absent).toBe(0.5)
    expect(s.present).toBe(0)
  })

  it("counts the unserved half as notCheckedIn on a future no-show", () => {
    const s = summariseDays(REF_H, [noShow({ unservedStatus: "NOT_CHECKED_IN" })], 8, 2026)
    expect(s.onLeave).toBe(0.5)
    expect(s.notCheckedIn).toBe(0.5)
  })

  it("holds the identity payroll divides by, in all three cases", () => {
    for (const d of [day(), noShow(), noShow({ unservedStatus: "NOT_CHECKED_IN" })]) {
      const s = summariseDays(REF_H, [d], 8, 2026)
      expect(s.present + s.absent + s.onLeave + s.notCheckedIn).toBe(s.workingDays)
    }
  })

  it("splits paid and unpaid leave by the same fraction", () => {
    const s = summariseDays(REF_H, [day({ leaveIsPaid: false })], 8, 2026)
    expect(s.onUnpaidLeave).toBe(0.5)
    expect(s.onPaidLeave).toBe(0)
  })

  it("charges a full LOP day for an unpaid half nobody served", () => {
    // 0.5 unpaid leave + 0.5 absent. Crediting `present` unconditionally here
    // would pay for half a day nobody worked.
    const s = summariseDays(REF_H, [noShow({ leaveIsPaid: false })], 8, 2026)
    expect(s.onUnpaidLeave + s.absent).toBe(1)
  })

  it("leaves a whole-day leave counted exactly as before", () => {
    const s = summariseDays(
      REF_H,
      [day({ status: "ON_LEAVE", leaveFraction: 1, attendanceId: null, expectedHours: 9 })],
      8,
      2026
    )
    expect(s.onLeave).toBe(1)
    expect(s.present).toBe(0)
    expect(s.absent).toBe(0)
  })

  it("leaves an ordinary present day counted exactly as before", () => {
    const s = summariseDays(REF_H, [day({ leaveFraction: 0, expectedHours: 9 })], 8, 2026)
    expect(s.present).toBe(1)
    expect(s.onLeave).toBe(0)
  })
})

describe("hours per attended working day", () => {
  // "Avg hours / day" divided `workedHours` by `present`, and those are not
  // the same set of days: `workedHours` includes holidays and weekly offs,
  // while `present` counts only working days. A missing check-out was the
  // worst of it — a whole day in the denominator, zero in the numerator.
  //
  // These two fields are the matched pair the card needs. They are additions:
  // `workedHours` and `present` keep their meanings, because payroll divides
  // by them.

  it("counts a fully recorded working day on both sides", async () => {
    const s = august({ attendances: [attendanceRow("2026-08-03")] })

    expect(s.workedHoursOnWorkingDays).toBe(9)
    expect(s.workingDaysFullyRecorded).toBe(1)
  })

  it("excludes a missing check-out from both sides", async () => {
    const s = august({
      attendances: [
        attendanceRow("2026-08-03"),
        attendanceRow("2026-08-04", { checkOut: null, workedHours: null }),
      ],
    })

    // The day still counts as present — payroll's identity depends on it —
    // so the old numerator/denominator pair read 9 over 2, or 4h 30m for a
    // day that was in fact worked in full.
    expect(s.present).toBe(2)
    expect(s.workedHours).toBe(9)

    expect(s.workedHoursOnWorkingDays).toBe(9)
    expect(s.workingDaysFullyRecorded).toBe(1)
  })

  it("excludes hours worked on a holiday from both sides", async () => {
    const s = august({
      attendances: [attendanceRow("2026-08-03"), attendanceRow("2026-08-05")],
      holidays: [holiday("2026-08-05", "Independence Day")],
    })

    // Unchanged: the holiday's hours are still reported, just not as a
    // working day the roster expected.
    expect(s.workedHours).toBe(18)
    expect(s.workedOnOffDays).toBe(1)

    expect(s.workedHoursOnWorkingDays).toBe(9)
    expect(s.workingDaysFullyRecorded).toBe(1)
  })

  it("leaves the four-term identity payroll divides by intact", async () => {
    // Asserted here so a later edit to the new fields cannot quietly move
    // one of the four terms and change what people are paid.
    const s = august({
      attendances: [
        attendanceRow("2026-08-03"),
        attendanceRow("2026-08-04", { checkOut: null, workedHours: null }),
        attendanceRow("2026-08-05"),
      ],
      holidays: [holiday("2026-08-05", "Independence Day")],
    })

    expect(s.present + s.absent + s.onLeave + s.notCheckedIn).toBe(s.workingDays)
  })
})
