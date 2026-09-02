import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
import type { Shift } from "../../generated/prisma/client"
import { parseDateOnly } from "../../utils/dates"
import {
  assertCanViewEmployee,
  getToday,
  monthRange,
  requireEmployeeForUser,
  resolveRange,
} from "./attendance.service"

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

const EMPLOYEE = {
  id: "emp-1",
  userId: "user-1",
  joiningDate: parseDateOnly("2024-01-06"),
  employmentStatus: "ACTIVE",
  shiftId: null,
}

const actor = (role: string, sub = "user-1") =>
  ({ sub, role, email: "a@demo.com", mustChangePassword: false }) as never

function emptyGrid() {
  vi.mocked(prisma.attendance.findMany).mockResolvedValue([])
  vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([])
  vi.mocked(prisma.holiday.findMany).mockResolvedValue([])
  vi.mocked(prisma.shift.findMany).mockResolvedValue([GENERAL])
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("requireEmployeeForUser", () => {
  it("returns the profile when one exists", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(EMPLOYEE as never)
    expect((await requireEmployeeForUser("user-1")).id).toBe("emp-1")
  })

  it("403s for an account with no employee profile", async () => {
    // HR, Finance and Super Admin are bare User rows with no Employee, so
    // they have no attendance of their own to record.
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null)
    await expect(requireEmployeeForUser("user-hr")).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe("monthRange", () => {
  it("spans the whole month", () => {
    const { from, to } = monthRange(2026, 8)
    expect(from.toISOString()).toBe("2026-08-01T00:00:00.000Z")
    expect(to.toISOString()).toBe("2026-08-31T00:00:00.000Z")
  })

  it("handles February in a non-leap year", () => {
    expect(monthRange(2026, 2).to.toISOString()).toBe("2026-02-28T00:00:00.000Z")
  })
})

describe("resolveRange", () => {
  it("defaults to the current office month", () => {
    const { from, to } = resolveRange()
    expect(from.toISOString()).toBe("2026-08-01T00:00:00.000Z")
    expect(to.toISOString()).toBe("2026-08-31T00:00:00.000Z")
  })

  it("400s when the range runs backwards", () => {
    expect(() => resolveRange("2026-08-15", "2026-08-01")).toThrow(
      expect.objectContaining({ statusCode: 400 })
    )
  })
})

describe("assertCanViewEmployee", () => {
  it.each(["HR_ADMIN", "SUPER_ADMIN", "FINANCE_OFFICER"])("lets %s view anyone", async (role) => {
    await expect(assertCanViewEmployee(actor(role), "emp-9")).resolves.toBeUndefined()
    // Short-circuits before touching the database at all.
    expect(prisma.employee.findUnique).not.toHaveBeenCalled()
  })

  it("lets an employee view themselves", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(EMPLOYEE as never)
    await expect(assertCanViewEmployee(actor("EMPLOYEE"), "emp-1")).resolves.toBeUndefined()
  })

  it("403s when an employee asks for someone else", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(EMPLOYEE as never)
    await expect(assertCanViewEmployee(actor("EMPLOYEE"), "emp-9")).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it("lets a manager view a direct report", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(EMPLOYEE as never)
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: "emp-9" } as never)
    await expect(
      assertCanViewEmployee(actor("REPORTING_MANAGER"), "emp-9")
    ).resolves.toBeUndefined()
    expect(prisma.employee.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "emp-9", reportingManagerId: "emp-1" },
      })
    )
  })

  it("403s when a manager asks for somebody who does not report to them", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(EMPLOYEE as never)
    vi.mocked(prisma.employee.findFirst).mockResolvedValue(null)
    await expect(
      assertCanViewEmployee(actor("REPORTING_MANAGER"), "emp-9")
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe("getToday", () => {
  beforeEach(() => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(EMPLOYEE as never)
    emptyGrid()
  })

  it("reports the office-local date, not the server's", async () => {
    const today = await getToday("user-1")
    expect(today.date).toBe("2026-08-15")
  })

  it("returns serverTime so the client clock can be anchored to it", async () => {
    // Without this the punch card is only as accurate as the laptop it runs
    // on: a machine three minutes fast shows "on time" while the server
    // records a late arrival.
    expect((await getToday("user-1")).serverTime).toBe(NOW.toISOString())
  })

  it("offers check-in and not check-out when nothing is recorded", async () => {
    const today = await getToday("user-1")
    expect(today).toMatchObject({
      status: "NOT_CHECKED_IN",
      canCheckIn: true,
      canCheckOut: false,
    })
  })

  it("offers check-out once checked in", async () => {
    vi.mocked(prisma.attendance.findMany).mockResolvedValue([
      {
        id: "att-1",
        employeeId: "emp-1",
        date: parseDateOnly("2026-08-15"),
        checkIn: new Date("2026-08-15T03:05:00.000Z"),
        checkOut: null,
        workedHours: null,
        isLate: false,
        isEarlyOut: false,
        source: "WEB",
        approval: "PENDING",
        approvedBy: null,
        approvedAt: null,
        approvalNote: null,
        regularisedAt: null,
        regularisedNote: null,
        correctedBy: null,
        correctedAt: null,
        correctionNote: null,
      },
    ] as never)

    expect(await getToday("user-1")).toMatchObject({
      status: "PRESENT",
      canCheckIn: false,
      canCheckOut: true,
    })
  })

  it("reports the shift in force today, with the break inside the span", async () => {
    const { shift } = await getToday("user-1")
    expect(shift).toMatchObject({ name: "General", expectedHours: 9, breakMinutes: 60 })
  })
})

describe("getToday on a half-day leave", () => {
  // `effectiveShift` narrows the shift to the half actually worked. Every
  // other consumer of `resolveShift` wraps it; `getToday` did not, so the
  // punch card printed the full span while the log row beneath it, the
  // report, approval and payroll all used the narrowed half.
  //
  // `startSession` on the stored request is the half the leave *covers*, so
  // FIRST_HALF leave means work starts at the midpoint.
  const halfDayLeave = (startSession: string, endSession: string) => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(EMPLOYEE as never)
    vi.mocked(prisma.attendance.findMany).mockResolvedValue([])
    vi.mocked(prisma.holiday.findMany).mockResolvedValue([])
    vi.mocked(prisma.shift.findMany).mockResolvedValue([GENERAL])
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
      {
        employeeId: "emp-1",
        startDate: parseDateOnly("2026-08-15"),
        endDate: parseDateOnly("2026-08-15"),
        startSession,
        endSession,
        leaveType: { name: "Casual Leave", isPaid: true },
      },
    ] as never)
  }

  it("starts the shift at the midpoint when the morning is the leave", async () => {
    halfDayLeave("FIRST_HALF", "FIRST_HALF")

    const { shift } = await getToday("user-1")

    expect(shift.startTime).toBe("13:30")
    expect(shift.endTime).toBe("18:00")
    expect(shift.expectedHours).toBe(4.5)
  })

  it("ends the shift at the midpoint when the afternoon is the leave", async () => {
    // The asymmetry is easy to invert, so it is asserted from both ends.
    halfDayLeave("SECOND_HALF", "SECOND_HALF")

    const { shift } = await getToday("user-1")

    expect(shift.startTime).toBe("09:00")
    expect(shift.endTime).toBe("13:30")
    expect(shift.expectedHours).toBe(4.5)
  })

  it("leaves a whole-day shift alone", async () => {
    halfDayLeave("FIRST_HALF", "SECOND_HALF")

    const { shift } = await getToday("user-1")

    expect(shift).toMatchObject({ startTime: "09:00", endTime: "18:00", expectedHours: 9 })
  })
})
