import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    salesTarget: { findMany: vi.fn(), upsert: vi.fn() },
    opportunity: { findMany: vi.fn() },
    employee: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { dec } from "../payroll/payroll.money"
import { getTargetYear, setSalesTarget } from "./target.service"

const USER = {
  sub: "user-2",
  role: "EMPLOYEE",
  email: "rahim@demo.com",
  mustChangePassword: false,
  salesRole: "SALES_USER",
} as never

const ADMIN = {
  sub: "user-1",
  role: "EMPLOYEE",
  email: "karim@demo.com",
  mustChangePassword: false,
  salesRole: "SALES_ADMIN",
} as never

/** A won deal, priced unless a test says otherwise. */
const won = (overrides: Record<string, unknown> = {}) => ({
  id: "opp-1",
  amount: dec("150000.00"),
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: never) =>
    (fn as unknown as (c: typeof prisma) => unknown)(prisma)) as never)
  // The caller is emp-2 unless a test says otherwise.
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-2" } } as never)
  vi.mocked(prisma.employee.findUnique).mockResolvedValue({
    id: "emp-2",
    fullName: "Rahim",
  } as never)
  vi.mocked(prisma.salesTarget.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.opportunity.findMany).mockResolvedValue([] as never)
})

describe("reading a target year", () => {
  it("returns four quarters even when nothing has been set", async () => {
    const year = await getTargetYear({ calendarYear: 2026 }, USER)

    expect(year.quarters).toHaveLength(4)
    expect(year.quarters.map((q) => q.quarter)).toEqual([1, 2, 3, 4])
  })

  it("reports an unset target as null rather than a target of zero", async () => {
    const year = await getTargetYear({ calendarYear: 2026 }, USER)

    // A target of zero would mean somebody decided this person should close
    // no deals. Nobody decided anything.
    expect(year.quarters[0].target).toBeNull()
    expect(year.quarters[0].achievement).toBe(0)
  })

  it("counts a won deal for whoever won it, not whoever owns the account", async () => {
    vi.mocked(prisma.opportunity.findMany).mockResolvedValue([won(), won({ id: "opp-2" })] as never)

    await getTargetYear({ calendarYear: 2026, employeeId: "emp-2" }, USER)

    expect(prisma.opportunity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ wonByEmployeeId: "emp-2" }),
      })
    )
  })

  it("does not count a deal that was won, reopened, and then lost", async () => {
    // wonByEmployeeId is deliberately never cleared, so it survives a reopen.
    // Without the status filter the deal would still be counted as a win.
    await getTargetYear({ calendarYear: 2026 }, USER)

    expect(prisma.opportunity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "WON" }) })
    )
  })

  it("asks for deals closed inside the quarter in office-local time", async () => {
    await getTargetYear({ calendarYear: 2026 }, USER)

    const q1 = vi.mocked(prisma.opportunity.findMany).mock.calls[0][0] as {
      where: { closedAt: { gte: Date; lt: Date } }
    }
    // Dhaka is six hours ahead, so Q1 opens six hours before UTC midnight.
    expect(q1.where.closedAt.gte.toISOString()).toBe("2025-12-31T18:00:00.000Z")
    expect(q1.where.closedAt.lt.toISOString()).toBe("2026-03-31T18:00:00.000Z")
  })

  it("excludes unpriced won deals from the value and counts them separately", async () => {
    vi.mocked(prisma.opportunity.findMany).mockResolvedValue([
      won(),
      won({ id: "opp-2", amount: null }),
    ] as never)

    const year = await getTargetYear({ calendarYear: 2026 }, USER)

    // Two deals were won. Only one carries a number, and the other is not
    // summed as zero.
    expect(year.quarters[0].achievement).toBe(2)
    expect(year.quarters[0].valueWon).toBe("150000.00")
    expect(year.quarters[0].unpricedWonCount).toBe(1)
  })

  it("refuses a Sales User asking for somebody else's targets", async () => {
    await expect(
      getTargetYear({ calendarYear: 2026, employeeId: "emp-9" }, USER)
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it("lets an admin read anybody's targets", async () => {
    await expect(
      getTargetYear({ calendarYear: 2026, employeeId: "emp-9" }, ADMIN)
    ).resolves.toMatchObject({ calendarYear: 2026 })
  })
})

describe("setting a target", () => {
  const body = { employeeId: "emp-2", calendarYear: 2026, quarter: 1, targetDeals: 10 }

  beforeEach(() => {
    vi.mocked(prisma.salesTarget.upsert).mockResolvedValue({
      id: "target-1",
      ...body,
      note: null,
      setBy: "user-1",
    } as never)
  })

  it("refuses a Sales User setting a target, including their own", async () => {
    await expect(setSalesTarget(body, USER)).rejects.toMatchObject({ statusCode: 403 })
    expect(prisma.salesTarget.upsert).not.toHaveBeenCalled()
  })

  it("upserts on the employee, year and quarter, and records who set it", async () => {
    await setSalesTarget(body, ADMIN)

    expect(prisma.salesTarget.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          employeeId_calendarYear_quarter: {
            employeeId: "emp-2",
            calendarYear: 2026,
            quarter: 1,
          },
        },
        create: expect.objectContaining({ targetDeals: 10, setBy: "user-1" }),
        update: expect.objectContaining({ targetDeals: 10, setBy: "user-1" }),
      })
    )
  })

  it("audits the change", async () => {
    await setSalesTarget(body, ADMIN)

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ entity: "SALES_TARGET", changedBy: "user-1" }),
      })
    )
  })

  it("refuses a target for somebody who is not an employee", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null as never)

    await expect(setSalesTarget(body, ADMIN)).rejects.toMatchObject({ statusCode: 400 })
    expect(prisma.salesTarget.upsert).not.toHaveBeenCalled()
  })
})
