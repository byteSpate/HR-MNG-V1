import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    employee: { findMany: vi.fn() },
    exchangeRate: { findMany: vi.fn() },
  },
}))

vi.mock("../attendance/attendance.summary", () => ({
  getMonthlySummary: vi.fn(),
}))

import prisma from "../../config/prisma"
import { getMonthlySummary } from "../attendance/attendance.summary"
import type { MonthlyAttendanceSummary } from "../attendance/attendance.types"
import { assertProcessable, preflight } from "./payroll.preflight"
import { dec } from "./payroll.money"

// July 2026 (31 days). "Today" is fixed a day after month-end unless a test
// overrides it, so blocker 1 (month not over) is closed by default and every
// other blocker can be tested in isolation.
const AFTER_MONTH_END = new Date("2026-08-01T03:00:00.000Z")

function summaryFor(over: Partial<MonthlyAttendanceSummary> = {}): MonthlyAttendanceSummary {
  return {
    employee: { id: "emp-1", fullName: "Ayesha Rahman", employeeCode: "BS-EMP-001", designation: "Engineer" },
    month: 7,
    year: 2026,
    workingDays: 27,
    present: 27,
    absent: 0,
    onLeave: 0,
    onPaidLeave: 0,
    onUnpaidLeave: 0,
    notCheckedIn: 0,
    late: 0,
    earlyOut: 0,
    holidays: 2,
    weeklyOffs: 4,
    workedOnOffDays: 0,
    workedHours: 216,
    workedHoursOnWorkingDays: 216,
    workingDaysFullyRecorded: 27,
    expectedHours: 216,
    expectedHoursToDate: 216,
    shortfallHours: 0,
    missingCheckOut: 0,
    pendingApproval: 0,
    approved: 27,
    regularised: 0,
    rejected: 0,
    ...over,
  }
}

const bdtComponents = [
  { code: "HOUSE_RENT", label: "House rent", kind: "EARNING" as const, calc: "PERCENT_OF_BASIC" as const, value: dec(50), sortOrder: 1, countsAsWages: true },
  { code: "PF", label: "Provident fund", kind: "DEDUCTION" as const, calc: "PERCENT_OF_BASIC" as const, value: dec(10), sortOrder: 1, countsAsWages: false },
  { code: "TAX", label: "Income tax", kind: "DEDUCTION" as const, calc: "FIXED" as const, value: dec(2500), sortOrder: 2, countsAsWages: false },
]

function rosterMember(over: Record<string, unknown> = {}) {
  return {
    id: "emp-1",
    fullName: "Ayesha Rahman",
    employeeCode: "BS-EMP-001",
    salaryStructureId: "struct-bdt",
    salaryStructure: {
      id: "struct-bdt",
      name: "Standard (BDT)",
      currency: "BDT",
      basic: dec(50000),
      isActive: true,
      components: bdtComponents,
    },
    ...over,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(AFTER_MONTH_END)
  vi.mocked(prisma.employee.findMany).mockResolvedValue([rosterMember()] as never)
  vi.mocked(getMonthlySummary).mockResolvedValue([summaryFor()])
  vi.mocked(prisma.exchangeRate.findMany).mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("a clean month", () => {
  it("reports ok: true with an empty blocker list", async () => {
    const report = await preflight(7, 2026)
    expect(report).toEqual({ month: 7, year: 2026, ok: true, blockers: [] })
  })
})

describe("blocker 1 — the month must be over", () => {
  it("blocks a month still in progress", async () => {
    vi.setSystemTime(new Date("2026-07-15T06:00:00.000Z"))
    const report = await preflight(7, 2026)
    expect(report.ok).toBe(false)
    expect(report.blockers.map((b) => b.code)).toContain("MONTH_NOT_OVER")
  })

  it("blocks on the last day of the month itself — it has not fully elapsed", async () => {
    vi.setSystemTime(new Date("2026-07-31T06:00:00.000Z"))
    const report = await preflight(7, 2026)
    expect(report.blockers.map((b) => b.code)).toContain("MONTH_NOT_OVER")
  })

  it("clears the day after month-end", async () => {
    vi.setSystemTime(new Date("2026-08-01T06:00:00.000Z"))
    const report = await preflight(7, 2026)
    expect(report.blockers.map((b) => b.code)).not.toContain("MONTH_NOT_OVER")
  })
})

describe("blocker 2 — unapproved attendance", () => {
  it("names the employee and the count", async () => {
    vi.mocked(getMonthlySummary).mockResolvedValue([summaryFor({ pendingApproval: 2 })])
    const report = await preflight(7, 2026)
    expect(report.ok).toBe(false)
    const blocker = report.blockers.find((b) => b.code === "UNAPPROVED_ATTENDANCE")
    expect(blocker?.employees).toEqual([
      expect.objectContaining({ employeeId: "emp-1", fullName: "Ayesha Rahman", detail: "2 day(s) pending approval" }),
    ])
  })

  it("clears once nobody has pending approval", async () => {
    vi.mocked(getMonthlySummary).mockResolvedValue([summaryFor({ pendingApproval: 0 })])
    const report = await preflight(7, 2026)
    expect(report.blockers.map((b) => b.code)).not.toContain("UNAPPROVED_ATTENDANCE")
  })
})

describe("blocker 3 — missing salary structure", () => {
  it("names an employee with no structure", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      rosterMember({ salaryStructureId: null, salaryStructure: null }),
    ] as never)
    const report = await preflight(7, 2026)
    expect(report.ok).toBe(false)
    const blocker = report.blockers.find((b) => b.code === "MISSING_SALARY_STRUCTURE")
    expect(blocker?.employees[0]).toMatchObject({ employeeId: "emp-1" })
  })
})

describe("blocker 4 — missing exchange rate", () => {
  it("fires for a roster containing one USD structure and no rate", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      rosterMember({
        id: "emp-usd",
        salaryStructureId: "struct-usd",
        salaryStructure: {
          id: "struct-usd",
          name: "Standard (USD)",
          currency: "USD",
          basic: dec(2000),
          isActive: true,
          components: bdtComponents,
        },
      }),
    ] as never)
    vi.mocked(getMonthlySummary).mockResolvedValue([
      summaryFor({ employee: { id: "emp-usd", fullName: "Sam Lee", employeeCode: "BS-EMP-002", designation: "Engineer" } }),
    ])
    vi.mocked(prisma.exchangeRate.findMany).mockResolvedValue([])

    const report = await preflight(7, 2026)
    expect(report.ok).toBe(false)
    const blocker = report.blockers.find((b) => b.code === "MISSING_EXCHANGE_RATE")
    expect(blocker?.message).toContain("USD")
    expect(blocker?.employees[0]).toMatchObject({ employeeId: "emp-usd", detail: "Paid in USD" })
  })

  it("clears once a covering rate exists", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      rosterMember({
        salaryStructure: {
          id: "struct-usd",
          name: "Standard (USD)",
          currency: "USD",
          basic: dec(2000),
          isActive: true,
          components: bdtComponents,
        },
      }),
    ] as never)
    vi.mocked(prisma.exchangeRate.findMany).mockResolvedValue([
      {
        id: "rate-1",
        base: "USD",
        quote: "BDT",
        rate: dec("122.5"),
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        createdBy: "user-1",
      },
    ] as never)
    const report = await preflight(7, 2026)
    expect(report.blockers.map((b) => b.code)).not.toContain("MISSING_EXCHANGE_RATE")
  })

  it("never asks about a currency the roster does not use", async () => {
    // Pure BDT roster: no exchangeRate query result is needed at all.
    await preflight(7, 2026)
    expect(prisma.exchangeRate.findMany).not.toHaveBeenCalled()
  })
})

describe("blocker 5 — negative net pay", () => {
  it("fires when fixed deductions exceed a heavily-LOP month", async () => {
    // 31 calendar days, 30 absent -> grossEarned collapses to ~2,419.35, but
    // PF (10% of full basic) and tax are not pro-rated and still take 7,500.
    vi.mocked(getMonthlySummary).mockResolvedValue([
      summaryFor({ workingDays: 27, present: 1, absent: 30, onUnpaidLeave: 0 }),
    ])
    const report = await preflight(7, 2026)
    expect(report.ok).toBe(false)
    const blocker = report.blockers.find((b) => b.code === "NEGATIVE_NET_PAY")
    expect(blocker?.employees[0]).toMatchObject({ employeeId: "emp-1" })
  })

  it("does not run — and reports nothing extra — while an earlier blocker is open", async () => {
    // If blocker 5 ran anyway here, the missing structure would crash it or
    // report a second, misleading blocker about the same underlying cause.
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      rosterMember({ salaryStructureId: null, salaryStructure: null }),
    ] as never)
    const report = await preflight(7, 2026)
    expect(report.blockers.map((b) => b.code)).toEqual(["MISSING_SALARY_STRUCTURE"])
  })

  it("clears for ordinary attendance", async () => {
    const report = await preflight(7, 2026)
    expect(report.blockers.map((b) => b.code)).not.toContain("NEGATIVE_NET_PAY")
  })
})

describe("all five at once", () => {
  it("reports every independent blocker together", async () => {
    vi.setSystemTime(new Date("2026-07-15T06:00:00.000Z")) // blocker 1
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      rosterMember({ salaryStructureId: null, salaryStructure: null }), // blocker 3
    ] as never)
    vi.mocked(getMonthlySummary).mockResolvedValue([summaryFor({ pendingApproval: 1 })]) // blocker 2

    const report = await preflight(7, 2026)
    const codes = report.blockers.map((b) => b.code)
    expect(codes).toContain("MONTH_NOT_OVER")
    expect(codes).toContain("UNAPPROVED_ATTENDANCE")
    expect(codes).toContain("MISSING_SALARY_STRUCTURE")
    // Blocker 5 does not run because 1–4 are not clear.
    expect(codes).not.toContain("NEGATIVE_NET_PAY")
  })
})

describe("assertProcessable", () => {
  it("resolves for a clean month", async () => {
    await expect(assertProcessable(7, 2026)).resolves.toBeUndefined()
  })

  it("throws a 409 carrying the blockers in its details", async () => {
    vi.mocked(getMonthlySummary).mockResolvedValue([summaryFor({ pendingApproval: 3 })])
    const failure = assertProcessable(7, 2026)
    await expect(failure).rejects.toMatchObject({ statusCode: 409 })
    await expect(failure).rejects.toMatchObject({
      details: { blockers: expect.arrayContaining([expect.objectContaining({ code: "UNAPPROVED_ATTENDANCE" })]) },
    })
  })
})

describe("the payroll roster excludes leavers", () => {
  it("asks only for ACTIVE and ON_LEAVE employees", async () => {
    // A RESIGNED or TERMINATED employee's final money is the settlement's.
    // This exclusion is what makes it impossible for both a run and a
    // settlement to pay the same days.
    await preflight(7, 2026)
    expect(prisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] },
        }),
      })
    )
  })

  it("excludes anyone who joined after the month ended", async () => {
    await preflight(7, 2026)
    const where = vi.mocked(prisma.employee.findMany).mock.calls[0][0]!.where as Record<string, unknown>
    expect(where.joiningDate).toEqual({ lte: new Date("2026-07-31T00:00:00.000Z") })
  })
})
