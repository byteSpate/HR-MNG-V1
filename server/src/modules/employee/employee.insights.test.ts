import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    employee: { findUnique: vi.fn(), findMany: vi.fn() },
    attendance: { findMany: vi.fn() },
    leaveRequest: { findMany: vi.fn(), count: vi.fn() },
    payslip: { findMany: vi.fn() },
    expenseClaim: { findMany: vi.fn() },
    holiday: { findMany: vi.fn() },
    shift: { findMany: vi.fn() },
  },
}))

vi.mock("../attendance/attendance.grid", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, buildDayGrid: vi.fn(async () => new Map()) }
})

import prisma from "../../config/prisma"
import { getEmployeeInsights } from "./employee.insights"

function viewer(role: any, sub = "u-v") {
  return { sub, role, email: "v@b.com", mustChangePassword: false, salesRole: null }
}

const subject = {
  id: "emp-1",
  userId: "u-1",
  reportingManagerId: "emp-mgr",
  joiningDate: new Date("2020-01-06T00:00:00.000Z"),
  employmentStatus: "ACTIVE",
  shiftId: null,
  lastWorkingDay: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.employee.findUnique).mockResolvedValue(subject as any)
  vi.mocked(prisma.employee.findMany).mockResolvedValue([])
  vi.mocked(prisma.attendance.findMany).mockResolvedValue([])
  vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([])
  vi.mocked(prisma.payslip.findMany).mockResolvedValue([])
  vi.mocked(prisma.expenseClaim.findMany).mockResolvedValue([])
})

describe("getEmployeeInsights authorisation", () => {
  it("404s an unknown employee", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null)
    await expect(getEmployeeInsights(viewer("HR_ADMIN"), "nope")).rejects.toThrowError(
      "Employee not found"
    )
  })

  it("refuses COLLEAGUE", async () => {
    // Unlike GET /:id, which never refuses. An insights payload with every
    // group absent is an empty object pretending to be an answer.
    vi.mocked(prisma.employee.findUnique)
      .mockResolvedValueOnce(subject as any)
      .mockResolvedValueOnce({ id: "emp-x" } as any)
    await expect(getEmployeeInsights(viewer("EMPLOYEE", "u-x"), "emp-1")).rejects.toThrowError(
      "not available"
    )
  })

  it("refuses SELF", async () => {
    // Employees see their own numbers on their role dashboard.
    await expect(getEmployeeInsights(viewer("EMPLOYEE", "u-1"), "emp-1")).rejects.toThrowError(
      "not available"
    )
  })

  it("refuses a manager who is not THIS employee's manager", async () => {
    vi.mocked(prisma.employee.findUnique)
      .mockResolvedValueOnce(subject as any)
      .mockResolvedValueOnce({ id: "emp-other" } as any)
    await expect(
      getEmployeeInsights(viewer("REPORTING_MANAGER", "u-mgr"), "emp-1")
    ).rejects.toThrowError("not available")
  })
})

describe("getEmployeeInsights tier scoping", () => {
  it("gives FINANCE money and nothing else", async () => {
    const result = await getEmployeeInsights(viewer("FINANCE_OFFICER"), "emp-1")
    expect(result.money).toBeDefined()
    expect(result.personal).toBeUndefined()
    expect(result.team).toBeUndefined()
  })

  it("gives MANAGER people series and no money", async () => {
    vi.mocked(prisma.employee.findUnique)
      .mockResolvedValueOnce(subject as any)
      .mockResolvedValueOnce({ id: "emp-mgr" } as any)
    const result = await getEmployeeInsights(viewer("REPORTING_MANAGER", "u-mgr"), "emp-1")
    expect(result.personal).toBeDefined()
    expect(result.money).toBeUndefined()
  })

  it("gives FULL everything", async () => {
    const result = await getEmployeeInsights(viewer("HR_ADMIN"), "emp-1")
    expect(result.personal).toBeDefined()
    expect(result.money).toBeDefined()
  })

  it("omits team entirely when the subject has no subordinates", async () => {
    // An empty "Team size" chart on an individual contributor's profile is a
    // question nobody asked.
    vi.mocked(prisma.employee.findMany).mockResolvedValue([])
    const result = await getEmployeeInsights(viewer("HR_ADMIN"), "emp-1")
    expect(result.team).toBeUndefined()
  })

  it("includes team when the subject has subordinates", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { joiningDate: new Date("2024-01-01T00:00:00.000Z"), lastWorkingDay: null },
    ] as any)
    const result = await getEmployeeInsights(viewer("HR_ADMIN"), "emp-1")
    expect(result.team?.teamSize).toHaveLength(6)
  })
})

describe("unmeasured is not zero", () => {
  it("leaves display EMPTY for months before the employee joined", async () => {
    // Collapse this and a new hire acquires a flawless six-month attendance
    // record on their first day.
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      ...subject,
      joiningDate: new Date(),
    } as any)
    const result = await getEmployeeInsights(viewer("HR_ADMIN"), "emp-1")
    const earliest = result.personal!.lateArrivals[0]
    expect(earliest.display).toBe("")
    expect(earliest.height).toBe(0)
  })

  it("shows \"0\" for a measured month with no late arrivals", async () => {
    // Nobody was late in March is a real and welcome fact.
    const result = await getEmployeeInsights(viewer("HR_ADMIN"), "emp-1")
    const latest = result.personal!.lateArrivals[5]
    expect(latest.display).toBe("0")
  })

  it("shares one month axis across every series", async () => {
    const result = await getEmployeeInsights(viewer("HR_ADMIN"), "emp-1")
    expect(result.months).toHaveLength(6)
    expect(result.personal!.lateArrivals.map((b) => b.label)).toEqual(result.months)
    expect(result.money!.netPay.map((b) => b.label)).toEqual(result.months)
  })
})

describe("series sources", () => {
  it("queries leave decisions on the subject's USER id, not the employee id", async () => {
    // approvedBy holds a User id, the same convention as changedBy on the
    // audit tables. Querying employee id returns a plausible always-empty
    // chart rather than an error.
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { joiningDate: new Date("2024-01-01T00:00:00.000Z"), lastWorkingDay: null },
    ] as any)
    await getEmployeeInsights(viewer("HR_ADMIN"), "emp-1")

    const decisionCall = vi
      .mocked(prisma.leaveRequest.findMany)
      .mock.calls.find(([args]) => (args as any)?.where?.approvedBy !== undefined)
    expect(decisionCall).toBeDefined()
    expect((decisionCall![0] as any).where.approvedBy).toBe("u-1")
  })

  it("attributes a leave request spanning two months to BOTH", async () => {
    const months = 6
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
      {
        startDate: new Date("2026-07-30T00:00:00.000Z"),
        endDate: new Date("2026-08-03T00:00:00.000Z"),
        leaveType: { countsHolidays: true },
      },
    ] as any)
    const result = await getEmployeeInsights(viewer("HR_ADMIN"), "emp-1")
    const withDays = result.personal!.leaveDaysTaken.filter((b) => b.display !== "" && b.display !== "0")
    expect(result.personal!.leaveDaysTaken).toHaveLength(months)
    // Attributing the whole request to its start month would show days taken
    // in a month the person was present.
    expect(withDays.length).toBeGreaterThanOrEqual(1)
  })

  it("shows an empty display for a month with no payroll run", async () => {
    const result = await getEmployeeInsights(viewer("FINANCE_OFFICER"), "emp-1")
    expect(result.money!.netPay.every((b) => b.display === "")).toBe(true)
  })

  it("charges a single-day SECOND_HALF request as half a day, not a whole one", async () => {
    // countLeaveDays ignores sessions entirely and would report 1 here — a
    // silent 2x overstatement on any chart containing a half day.
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
      {
        startDate: new Date("2026-07-15T00:00:00.000Z"),
        endDate: new Date("2026-07-15T00:00:00.000Z"),
        startSession: "SECOND_HALF",
        endSession: "SECOND_HALF",
        leaveType: { countsHolidays: true },
      },
    ] as any)
    const result = await getEmployeeInsights(viewer("HR_ADMIN"), "emp-1")
    const july = result.personal!.leaveDaysTaken.find((b) => b.label === "Jul")
    expect(july?.display).toBe("0.5")
  })
})
