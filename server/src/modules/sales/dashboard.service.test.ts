import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    salesTarget: { findMany: vi.fn() },
    opportunity: { findMany: vi.fn(), count: vi.fn() },
    salesAccount: { count: vi.fn(), findMany: vi.fn() },
    salesCommunication: { findMany: vi.fn() },
    auditLog: { findMany: vi.fn() },
    employee: { findUnique: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { dec } from "../payroll/payroll.money"
import { getSalesDashboard } from "./dashboard.service"
import type { SalesDashboardPayload } from "./sales.types"

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

const NOW = new Date("2026-02-15T06:00:00.000Z")

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-2" } } as never)
  vi.mocked(prisma.employee.findUnique).mockResolvedValue({
    id: "emp-2",
    fullName: "Rahim",
    userId: "user-2",
  } as never)
  vi.mocked(prisma.salesTarget.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.opportunity.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.opportunity.count).mockResolvedValue(0 as never)
  vi.mocked(prisma.salesAccount.count).mockResolvedValue(0 as never)
  vi.mocked(prisma.salesAccount.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.salesCommunication.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.employee.findMany).mockResolvedValue([] as never)
})

const stat = (payload: SalesDashboardPayload, label: string) =>
  payload.stats.find((s) => s.label === label)

describe("the sales dashboard", () => {
  it("says a target is not set rather than showing a target of zero", async () => {
    const payload = await getSalesDashboard({ now: NOW }, USER)

    const target = stat(payload, "Quarterly Target")
    expect(target?.value).toMatch(/not set/i)
    expect(target?.value).not.toBe("0")
  })

  it("omits achievement against target entirely when no target exists", async () => {
    const payload = await getSalesDashboard({ now: NOW }, USER)

    // "0 of 0" is a sentence about a decision nobody made.
    expect(stat(payload, "Against Target")).toBeUndefined()
  })

  it("shows achievement against target once a target is set", async () => {
    vi.mocked(prisma.salesTarget.findMany).mockResolvedValue([
      { quarter: 1, targetDeals: 10, note: null },
    ] as never)
    vi.mocked(prisma.opportunity.findMany).mockImplementation((async (args: never) => {
      const where = (args as { where?: { status?: string } }).where
      return where?.status === "WON" ? [{ amount: dec("50000.00") }] : []
    }) as never)

    const payload = await getSalesDashboard({ now: NOW }, USER)

    expect(stat(payload, "Against Target")?.value).toBe("1 of 10")
  })

  it("excludes unpriced deals from the ongoing value and says how many", async () => {
    vi.mocked(prisma.opportunity.findMany).mockImplementation((async (args: never) => {
      const where = (args as { where?: { status?: string } }).where
      if (where?.status === "ONGOING") {
        return [{ amount: dec("200000.00") }, { amount: null }, { amount: null }]
      }
      return []
    }) as never)

    const payload = await getSalesDashboard({ now: NOW }, USER)

    const ongoing = stat(payload, "Ongoing")
    expect(ongoing?.value).toBe("3")
    // The two unpriced deals are named, not folded in as zero.
    expect(ongoing?.sub).toMatch(/2 unpriced/i)
  })

  it("counts accounts worked on from activity, not from assignment", async () => {
    vi.mocked(prisma.salesCommunication.findMany).mockResolvedValue([
      { salesAccountId: "sa-1" },
      { salesAccountId: "sa-1" },
      { salesAccountId: "sa-2" },
    ] as never)

    const payload = await getSalesDashboard({ now: NOW }, USER)

    // Two distinct accounts, three communications. An account assigned and
    // never touched does not appear here at all.
    expect(stat(payload, "Accounts Worked On")?.value).toBe("2")
  })

  it("gives every stat a tone", async () => {
    const payload = await getSalesDashboard({ now: NOW }, USER)

    for (const s of payload.stats) {
      expect(s.tone).toMatch(/^(green|yellow|red|neutral)$/)
    }
  })

  it("ships the four action rows that have tables behind them", async () => {
    const payload = await getSalesDashboard({ now: NOW }, USER)

    expect(payload.actions.map((row) => row.key)).toEqual([
      "closing",
      "unverified",
      "quiet",
      "stuck",
    ])
  })

  it("names what is not built instead of rendering it as zero", async () => {
    const payload = await getSalesDashboard({ now: NOW }, USER)

    // Meetings and tasks arrive in phase 3. An empty "Tasks due" row would
    // read as "no tasks", which is a number nobody measured.
    expect(payload.notBuilt).toEqual(["meetings", "tasks"])
    expect(payload.actions.map((row) => row.key)).not.toContain("tasks")
    expect(payload.actions.map((row) => row.key)).not.toContain("meetings")
  })

  it("keys every badge to the row it came from, counted once", async () => {
    vi.mocked(prisma.opportunity.count).mockResolvedValue(4 as never)

    const payload = await getSalesDashboard({ now: NOW }, USER)

    for (const row of payload.actions) {
      expect(payload.badges[row.href]).toBe(row.count)
    }
  })

  it("refuses a Sales User asking for somebody else's dashboard", async () => {
    await expect(getSalesDashboard({ now: NOW, employeeId: "emp-9" }, USER)).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it("lets an admin roll the whole team up, naming each person", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "emp-2", fullName: "Rahim", userId: "user-2" },
      { id: "emp-3", fullName: "Nasir", userId: "user-3" },
    ] as never)

    const payload = await getSalesDashboard({ now: NOW, employeeId: "all" }, ADMIN)

    expect(payload.team?.map((row) => row.employeeName)).toEqual(["Rahim", "Nasir"])
  })

  it("refuses a Sales User asking for the team roll-up", async () => {
    await expect(getSalesDashboard({ now: NOW, employeeId: "all" }, USER)).rejects.toMatchObject({
      statusCode: 403,
    })
  })
})

describe("the sales dashboard, after review", () => {
  it("credits work to whoever did it, not to the current owner", async () => {
    await getSalesDashboard({ now: NOW }, USER)

    // An opportunity changes hands. Counting activity by ownerEmployeeId
    // would hand the new owner credit for work they did not do, and take it
    // from the person who did. The audit trail records who acted.
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ entity: "OPPORTUNITY", changedBy: "user-2" }),
      })
    )
    const auditCall = vi.mocked(prisma.auditLog.findMany).mock.calls[0][0] as any
    expect(auditCall.where.changedAt).toEqual({ gte: expect.any(Date), lt: expect.any(Date) })
  })

  it("reads activity from an immutable timestamp, not from lastActivityAt", async () => {
    await getSalesDashboard({ now: NOW }, USER)

    // lastActivityAt holds only the most recent touch, so a deal worked in Q1
    // and again in Q3 vanishes from Q1 entirely. An audit row is written once
    // and never moves.
    const workedCalls = vi
      .mocked(prisma.opportunity.findMany)
      .mock.calls.map((call) => JSON.stringify((call[0] as object) ?? {}))
    expect(workedCalls.some((c) => c.includes("lastActivityAt"))).toBe(false)
  })

  it("gives an admin both bands, not a stripped payload", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "emp-2", fullName: "Rahim", userId: "user-2" },
    ] as never)

    const payload = await getSalesDashboard({ now: NOW, employeeId: "all" }, ADMIN)

    expect(payload.quarters.map((q) => q.quarter)).toEqual([1, 2, 3, 4])
    expect(payload.actions.map((row) => row.key)).toEqual([
      "closing",
      "unverified",
      "quiet",
      "stuck",
    ])
    expect(Object.keys(payload.badges)).toHaveLength(4)
  })

  it("takes the documented employeeId=all rather than a second spelling", async () => {
    const payload = await getSalesDashboard({ now: NOW, employeeId: "all" }, ADMIN)
    expect(payload.scope).toBe("all")
  })

  it("includes an opportunity closing today", async () => {
    await getSalesDashboard({ now: NOW }, USER)

    const closing = vi
      .mocked(prisma.opportunity.count)
      .mock.calls.map((call) => call[0] as { where?: { expectedCloseDate?: { gte?: Date } } })
      .find((args) => args?.where?.expectedCloseDate)

    // expectedCloseDate is date-only at UTC midnight. Starting the window at
    // the current instant drops everything due today the moment midnight
    // passes.
    expect(closing?.where?.expectedCloseDate?.gte?.toISOString()).toBe("2026-02-15T00:00:00.000Z")
  })

  it("takes every stat tone from the tone policy, including the flat ones", async () => {
    vi.mocked(prisma.salesTarget.findMany).mockResolvedValue([
      { quarter: 1, targetDeals: 4 },
    ] as never)
    vi.mocked(prisma.opportunity.findMany).mockImplementation((async (args: never) => {
      const where = (args as { where?: { status?: string } }).where
      return where?.status === "WON" ? [{ amount: dec("1.00") }] : []
    }) as never)

    const payload = await getSalesDashboard({ now: NOW }, USER)

    // One win against a target of four is 25 per cent, which the rate policy
    // calls red. A literal would have said "neutral".
    expect(stat(payload, "Against Target")?.tone).toBe("red")
    expect(stat(payload, "Total Opportunities")?.tone).toBe("neutral")
  })
})
