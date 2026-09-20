import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    salesTarget: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    opportunity: { findMany: vi.fn() },
    employee: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import prisma from "../../../config/prisma"
import { dec } from "../../payroll/payroll.money"
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

/** Mid-August 2026: Q1 and Q2 are over, Q3 is running. */
const NOW = new Date("2026-08-15T06:00:00.000Z")

/** A deal won at an instant, priced unless a test says otherwise. */
const wonOn = (closedAt: string, amount: string | null = "150000.00") => ({
  amount: amount === null ? null : dec(amount),
  closedAt: new Date(closedAt),
})

/** Rahim's 2026 target: ৳40 lakh from Q1. */
const targetRow = (overrides: Record<string, unknown> = {}) => ({
  id: "target-1",
  employeeId: "emp-2",
  calendarYear: 2026,
  amount: dec("4000000.00"),
  startQuarter: 1,
  note: null,
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
  vi.mocked(prisma.salesTarget.findUnique).mockResolvedValue(null as never)
  vi.mocked(prisma.opportunity.findMany).mockResolvedValue([] as never)
})

describe("reading a target year", () => {
  it("returns four quarters with no target in any of them when nothing has been set", async () => {
    const year = await getTargetYear({ calendarYear: 2026, now: NOW }, USER)

    expect(year.quarters.map((q) => q.quarter)).toEqual([1, 2, 3, 4])
    expect(year.yearlyTarget).toBeNull()
    // A target of zero would mean somebody decided this person should win
    // nothing. Nobody decided anything.
    expect(year.quarters.map((q) => q.target)).toEqual([null, null, null, null])
  })

  it("splits the yearly target and carries an ended quarter's shortfall into the next", async () => {
    vi.mocked(prisma.salesTarget.findMany).mockResolvedValue([targetRow()] as never)
    vi.mocked(prisma.opportunity.findMany).mockResolvedValue([
      wonOn("2026-02-10T06:00:00.000Z", "1300000.00"),
      wonOn("2026-05-10T06:00:00.000Z", "700000.00"),
    ] as never)

    const year = await getTargetYear({ calendarYear: 2026, now: NOW }, USER)

    expect(year.yearlyTarget).toBe("4000000.00")
    expect(year.startQuarter).toBe(1)
    expect(year.quarters.map((q) => q.phase)).toEqual(["ended", "ended", "current", "upcoming"])
    // Q1 beat its 10L by 3L. Q2 fell 3L short, so Q3 is 10L + 3L.
    expect(year.quarters[0].gap).toBe("-300000.00")
    expect(year.quarters[2].carried).toBe("300000.00")
    expect(year.quarters[2].target).toBe("1300000.00")
    expect(year.valueWon).toBe("2000000.00")
    expect(year.dealsWon).toBe(2)
  })

  it("puts a deal in the quarter of its office-local close date", async () => {
    // 19:00 UTC on 31 March is 01:00 on 1 April in Dhaka: a Q2 deal.
    vi.mocked(prisma.opportunity.findMany).mockResolvedValue([
      wonOn("2026-03-31T19:00:00.000Z"),
    ] as never)

    const year = await getTargetYear({ calendarYear: 2026, now: NOW }, USER)

    expect(year.quarters[0].dealsWon).toBe(0)
    expect(year.quarters[1].dealsWon).toBe(1)
  })

  it("asks for deals won by this person across the whole office-local year", async () => {
    await getTargetYear({ calendarYear: 2026, employeeId: "emp-2", now: NOW }, USER)

    const where = (vi.mocked(prisma.opportunity.findMany).mock.calls[0][0] as {
      where: { wonByEmployeeId: string; status: string; closedAt: { gte: Date; lt: Date } }
    }).where
    // Credit follows whoever won the deal, not whoever owns the account now.
    expect(where.wonByEmployeeId).toBe("emp-2")
    // wonByEmployeeId survives a reopen, so a deal won, reopened and then
    // lost still carries it. Without the status filter it would still count.
    expect(where.status).toBe("WON")
    // Dhaka is six hours ahead, so the year opens six hours before UTC midnight.
    expect(where.closedAt.gte.toISOString()).toBe("2025-12-31T18:00:00.000Z")
    expect(where.closedAt.lt.toISOString()).toBe("2026-12-31T18:00:00.000Z")
  })

  it("leaves unpriced wins out of the value and counts them separately", async () => {
    vi.mocked(prisma.opportunity.findMany).mockResolvedValue([
      wonOn("2026-02-10T06:00:00.000Z"),
      wonOn("2026-02-11T06:00:00.000Z", null),
    ] as never)

    const year = await getTargetYear({ calendarYear: 2026, now: NOW }, USER)

    // Two deals were won. Only one carries a number, and the other is not
    // summed as zero.
    expect(year.quarters[0].dealsWon).toBe(2)
    expect(year.quarters[0].valueWon).toBe("150000.00")
    expect(year.quarters[0].unpricedWonCount).toBe(1)
    expect(year.unpricedWonCount).toBe(1)
  })

  it("refuses a Sales User asking for somebody else's targets", async () => {
    await expect(
      getTargetYear({ calendarYear: 2026, employeeId: "emp-9", now: NOW }, USER)
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it("lets an admin read anybody's targets", async () => {
    await expect(
      getTargetYear({ calendarYear: 2026, employeeId: "emp-9", now: NOW }, ADMIN)
    ).resolves.toMatchObject({ calendarYear: 2026 })
  })
})

describe("setting a yearly target", () => {
  const body = { employeeId: "emp-2", calendarYear: 2026, amount: "4000000.00", startQuarter: 1 }

  beforeEach(() => {
    vi.mocked(prisma.salesTarget.upsert).mockResolvedValue(targetRow() as never)
  })

  it("refuses a Sales User setting a target, including their own", async () => {
    await expect(setSalesTarget(body, USER)).rejects.toMatchObject({ statusCode: 403 })
    expect(prisma.salesTarget.upsert).not.toHaveBeenCalled()
  })

  it("keeps one row per person per year, with the amount, the start quarter and who set it", async () => {
    await setSalesTarget(body, ADMIN)

    const args = vi.mocked(prisma.salesTarget.upsert).mock.calls[0][0] as {
      where: unknown
      create: { amount: { toFixed(dp: number): string }; startQuarter: number; setBy: string }
      update: { amount: { toFixed(dp: number): string }; startQuarter: number; setBy: string }
    }
    expect(args.where).toEqual({ employeeId_calendarYear: { employeeId: "emp-2", calendarYear: 2026 } })
    expect(args.create.amount.toFixed(2)).toBe("4000000.00")
    expect(args.create).toMatchObject({ startQuarter: 1, setBy: "user-1" })
    expect(args.update.amount.toFixed(2)).toBe("4000000.00")
    expect(args.update).toMatchObject({ startQuarter: 1, setBy: "user-1" })
  })

  it("audits the old target beside the new one", async () => {
    vi.mocked(prisma.salesTarget.findUnique).mockResolvedValue(
      targetRow({ amount: dec("3000000.00"), startQuarter: 2 }) as never
    )

    await setSalesTarget(body, ADMIN)

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "SALES_TARGET",
          changedBy: "user-1",
          before: { amount: "3000000.00", startQuarter: 2 },
          after: expect.objectContaining({ amount: "4000000.00", startQuarter: 1 }),
        }),
      })
    )
  })

  it("refuses a target for somebody who is not an employee", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null as never)

    await expect(setSalesTarget(body, ADMIN)).rejects.toMatchObject({ statusCode: 400 })
    expect(prisma.salesTarget.upsert).not.toHaveBeenCalled()
  })

  it("answers with the year worked out again from the new target", async () => {
    const year = await setSalesTarget(body, ADMIN, NOW)

    expect(year.yearlyTarget).toBe("4000000.00")
    expect(year.quarters[0].target).toBe("1000000.00")
  })
})
