import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    salesTarget: { findMany: vi.fn() },
    opportunity: { findMany: vi.fn(), count: vi.fn() },
    salesAccount: { count: vi.fn(), findMany: vi.fn() },
    salesCommunication: { findMany: vi.fn() },
    salesMeeting: { count: vi.fn(), findMany: vi.fn() },
    salesTask: { count: vi.fn() },
    weeklyReport: { findUnique: vi.fn(), count: vi.fn() },
    auditLog: { findMany: vi.fn() },
    employee: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { bdt } from "../dashboard/dashboard.format"
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

/** Mid-August 2026: Q1 and Q2 are over, Q3 is running. */
const NOW = new Date("2026-08-15T06:00:00.000Z")

type Product = { lineValue: string | null; marginPercent: string | null }
type Win = { wonByEmployeeId?: string; amount: string | null; closedAt: string; lines?: Product[] }

/** Won deals answer a WON query, open deals an ONGOING one, and nothing else answers. */
function deals({ won = [] as Win[], ongoing = [] as { amount: string | null }[] } = {}) {
  vi.mocked(prisma.opportunity.findMany).mockImplementation((async (args: never) => {
    const where = (args as { where?: { status?: string } }).where
    if (where?.status === "WON") {
      return won.map((deal) => ({
        wonByEmployeeId: deal.wonByEmployeeId ?? "emp-2",
        amount: deal.amount === null ? null : dec(deal.amount),
        closedAt: new Date(deal.closedAt),
        lines: (deal.lines ?? []).map((product) => ({
          lineValue: product.lineValue === null ? null : dec(product.lineValue),
          marginPercent: product.marginPercent === null ? null : dec(product.marginPercent),
        })),
      }))
    }
    if (where?.status === "ONGOING") {
      return ongoing.map((deal) => ({ amount: deal.amount === null ? null : dec(deal.amount) }))
    }
    return []
  }) as never)
}

/** Rahim: ৳40 lakh for 2026, from Q1. */
const RAHIM_TARGET = { employeeId: "emp-2", amount: dec("4000000.00"), startQuarter: 1, note: null }

/**
 * Q1 beats its 10L by 3L, Q2 falls 3L short, Q3 has 5L so far. Each deal is
 * one product; the Q2 product has no margin typed.
 */
const RAHIM_WINS: Win[] = [
  { amount: "1300000.00", closedAt: "2026-02-10T06:00:00.000Z", lines: [{ lineValue: "1300000.00", marginPercent: "10" }] },
  { amount: "700000.00", closedAt: "2026-05-10T06:00:00.000Z", lines: [{ lineValue: "700000.00", marginPercent: null }] },
  { amount: "500000.00", closedAt: "2026-07-20T06:00:00.000Z", lines: [{ lineValue: "500000.00", marginPercent: "10" }] },
]

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
  vi.mocked(prisma.salesMeeting.count).mockResolvedValue(0 as never)
  vi.mocked(prisma.salesMeeting.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.salesTask.count).mockResolvedValue(0 as never)
})

const stat = (payload: SalesDashboardPayload, label: string) =>
  payload.stats.find((s) => s.label === label)

describe("targets on the sales dashboard", () => {
  it("says a target is not set rather than showing a target of zero", async () => {
    const payload = await getSalesDashboard({ now: NOW }, USER)

    for (const label of ["Quarterly Target", "Yearly Target"]) {
      expect(stat(payload, label)?.value).toMatch(/not set/i)
    }
  })

  it("omits achievement against target entirely when no target exists", async () => {
    const payload = await getSalesDashboard({ now: NOW }, USER)

    // "0% of nothing" is a sentence about a decision nobody made.
    expect(stat(payload, "Against Target")).toBeUndefined()
  })

  it("shows the quarter's target in taka, with the shortfall carried from the quarter before", async () => {
    vi.mocked(prisma.salesTarget.findMany).mockResolvedValue([RAHIM_TARGET] as never)
    deals({ won: RAHIM_WINS })

    const payload = await getSalesDashboard({ now: NOW }, USER)

    const target = stat(payload, "Quarterly Target")
    expect(target?.value).toBe(bdt(dec("1300000.00")))
    expect(target?.sub).toMatch(/carried from Q2/)
  })

  it("measures the quarter's achievement in taka won, and says how many deals", async () => {
    vi.mocked(prisma.salesTarget.findMany).mockResolvedValue([RAHIM_TARGET] as never)
    deals({ won: RAHIM_WINS })

    const payload = await getSalesDashboard({ now: NOW }, USER)

    const achievement = stat(payload, "Quarterly Achievement")
    expect(achievement?.value).toBe(bdt(dec("500000.00")))
    // The count has a tile of its own; this one is the money.
    expect(stat(payload, "Deals Won")?.value).toBe("1")
    expect(stat(payload, "Deals Won")?.sub).toBe("Q3 2026")
  })

  it("shows how far the quarter is against its target, with a tone from the rate policy", async () => {
    vi.mocked(prisma.salesTarget.findMany).mockResolvedValue([RAHIM_TARGET] as never)
    deals({ won: RAHIM_WINS })

    const payload = await getSalesDashboard({ now: NOW }, USER)

    // 5L of 13L is 38 per cent, which the rate policy calls red.
    const against = stat(payload, "Against Target")
    expect(against?.value).toBe("38%")
    expect(against?.sub).toMatch(/short by/)
    expect(against?.tone).toBe("red")
  })

  it("shows the yearly target and what was won against it", async () => {
    vi.mocked(prisma.salesTarget.findMany).mockResolvedValue([RAHIM_TARGET] as never)
    deals({ won: RAHIM_WINS })

    const payload = await getSalesDashboard({ now: NOW }, USER)

    expect(stat(payload, "Yearly Target")?.value).toBe(bdt(dec("4000000.00")))
    const yearly = stat(payload, "Yearly Achievement")
    expect(yearly?.value).toBe(bdt(dec("2500000.00")))
    expect(yearly?.sub).toMatch(/of the yearly target/)
  })

  it("drops the separate Value Won tile, which would repeat the quarter's achievement", async () => {
    const payload = await getSalesDashboard({ now: NOW }, USER)

    expect(stat(payload, "Value Won")).toBeUndefined()
  })

  it("shows twelve tiles with no target, and thirteen once one is set", async () => {
    const without = await getSalesDashboard({ now: NOW }, USER)
    vi.mocked(prisma.salesTarget.findMany).mockResolvedValue([RAHIM_TARGET] as never)
    const withTarget = await getSalesDashboard({ now: NOW }, USER)

    expect(without.stats).toHaveLength(12)
    // "Against Target" is the thirteenth: it only means something with a target.
    expect(withTarget.stats).toHaveLength(13)
    expect(withTarget.stats.slice(0, 4).map((s) => s.label)).toEqual([
      "Quarterly Target",
      "Quarterly Achievement",
      "Deals Won",
      "Against Target",
    ])
  })

  it("groups the tiles into this quarter, this year and the pipeline, each with an icon", async () => {
    vi.mocked(prisma.salesTarget.findMany).mockResolvedValue([RAHIM_TARGET] as never)

    const payload = await getSalesDashboard({ now: NOW }, USER)

    expect(payload.stats.map((s) => s.group)).toEqual([
      ...Array(5).fill("This quarter"),
      ...Array(3).fill("This year"),
      ...Array(5).fill("Pipeline"),
    ])
    // The quarter's margin sits with the quarter, not after the year.
    expect(stat(payload, "Margin Won")?.group).toBe("This quarter")
    // A meaning, not a component name: the client maps it to an icon.
    for (const s of payload.stats) {
      expect(s.icon).toMatch(/^[a-z]+$/)
    }
  })

  it("carries each quarter's target, carry and wins into the quarter table", async () => {
    vi.mocked(prisma.salesTarget.findMany).mockResolvedValue([RAHIM_TARGET] as never)
    deals({ won: RAHIM_WINS })

    const payload = await getSalesDashboard({ now: NOW }, USER)

    expect(payload.quarters.map((q) => q.phase)).toEqual(["ended", "ended", "current", "upcoming"])
    expect(payload.quarters[2]).toMatchObject({ carried: "300000.00", target: "1300000.00", valueWon: "500000.00", dealsWon: 1 })
    // Q3 is still running, so what Q4 carries is not known yet.
    expect(payload.quarters[3].carryPending).toBe(true)
  })

  it("asks for this person's wins across the whole office-local year", async () => {
    await getSalesDashboard({ now: NOW }, USER)

    const won = vi
      .mocked(prisma.opportunity.findMany)
      .mock.calls.map((call) => call[0] as { where?: Record<string, any> })
      .find((args) => args?.where?.status === "WON")
    expect(won?.where?.wonByEmployeeId).toBe("emp-2")
    expect(won?.where?.closedAt.gte.toISOString()).toBe("2025-12-31T18:00:00.000Z")
    expect(won?.where?.closedAt.lt.toISOString()).toBe("2026-12-31T18:00:00.000Z")
  })
})

describe("margin on the sales dashboard", () => {
  it("adds up the product margins on won deals, for the quarter and for the year", async () => {
    deals({ won: RAHIM_WINS })

    const payload = await getSalesDashboard({ now: NOW }, USER)

    // Q3: 10% of 5L. The year: 10% of 13L plus 10% of 5L; the Q2 product has
    // no margin, so it is left out and named.
    expect(stat(payload, "Margin Won")?.value).toBe(bdt(dec("50000.00")))
    const yearly = stat(payload, "Yearly Margin")
    expect(yearly?.value).toBe(bdt(dec("180000.00")))
    expect(yearly?.sub).toMatch(/1 product with no margin yet/)
  })

  it("names won deals that have no products, since their margin cannot be known", async () => {
    deals({ won: [{ amount: "500000.00", closedAt: "2026-07-20T06:00:00.000Z", lines: [] }] })

    const payload = await getSalesDashboard({ now: NOW }, USER)

    const margin = stat(payload, "Margin Won")
    expect(margin?.value).toMatch(/no margin yet/i)
    expect(margin?.sub).toMatch(/1 won deal with no products/)
  })

  it("does not count margin on deals that are still open", async () => {
    deals({ won: [], ongoing: [{ amount: "900000.00" }] })

    const payload = await getSalesDashboard({ now: NOW }, USER)

    expect(stat(payload, "Margin Won")?.value).toBe(bdt(dec("0")))
  })

  it("says no margin yet rather than ৳0 when no won product carries one", async () => {
    deals({
      won: [{ amount: "500000.00", closedAt: "2026-07-20T06:00:00.000Z", lines: [{ lineValue: "500000.00", marginPercent: null }] }],
    })

    const payload = await getSalesDashboard({ now: NOW }, USER)

    expect(stat(payload, "Margin Won")?.value).toMatch(/no margin yet/i)
  })
})

describe("the rest of the sales dashboard", () => {
  it("excludes unpriced deals from the ongoing value and says how many", async () => {
    deals({ ongoing: [{ amount: "200000.00" }, { amount: null }, { amount: null }] })

    const payload = await getSalesDashboard({ now: NOW }, USER)

    const ongoing = stat(payload, "Ongoing")
    expect(ongoing?.value).toBe("3")
    // The two unpriced deals are named, not folded in as zero.
    expect(ongoing?.sub).toMatch(/2 with no price yet/i)
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
    vi.mocked(prisma.salesTarget.findMany).mockResolvedValue([RAHIM_TARGET] as never)
    deals({ won: RAHIM_WINS })

    const payload = await getSalesDashboard({ now: NOW }, USER)

    for (const s of payload.stats) {
      expect(s.tone).toMatch(/^(green|yellow|red|neutral)$/)
    }
  })

  it("ships all eight action rows, today's meetings and tasks first, then meetings with no minutes", async () => {
    const payload = await getSalesDashboard({ now: NOW }, USER)

    expect(payload.actions.map((row) => row.key))
      .toEqual(["meetings", "tasks", "minutes", "weekly", "closing", "unverified", "quiet", "stuck"])
  })

  it("has nothing left that is not built, so the notice goes away", async () => {
    const payload = await getSalesDashboard({ now: NOW }, USER)

    expect(payload.notBuilt).toEqual([])
  })

  it("counts the meetings I attend today and this week, in office time", async () => {
    // NOW is noon on 15 Aug in Dhaka. The day starts at 18:00 UTC on the 14th.
    const DAY_END = "2026-08-15T18:00:00.000Z"
    // The scheduled-meeting counts only; the minutes row counts completed ones.
    const scheduled = () =>
      vi.mocked(prisma.salesMeeting.count).mock.calls
        .map(([args]: any[]) => args.where)
        .filter((where) => where.status === "SCHEDULED")
    vi.mocked(prisma.salesMeeting.count).mockImplementation((async (args: any) =>
      args.where.status !== "SCHEDULED" ? 0 : args.where.scheduledAt.lt.toISOString() === DAY_END ? 1 : 3) as never)

    const payload = await getSalesDashboard({ now: NOW }, USER)

    const row = payload.actions.find((r) => r.key === "meetings")!
    expect(row).toMatchObject({ label: "Meetings today and this week", count: 3, detail: "1 today", href: "/meetings" })
    const where = scheduled()[0]
    expect(where).toMatchObject({
      status: "SCHEDULED",
      attendees: { some: { side: "OURS", employeeId: { in: ["emp-2"] } } },
    })
    expect(where.scheduledAt.gte.toISOString()).toBe("2026-08-14T18:00:00.000Z")
    const weekEnds = scheduled().map((w) => w.scheduledAt.lt.toISOString())
    expect(weekEnds).toContain("2026-08-21T18:00:00.000Z")
  })

  it("counts my pending tasks due today or overdue, and says how many are late", async () => {
    vi.mocked(prisma.salesTask.count).mockImplementation((async (args: any) =>
      args.where.dueOn.lte ? 4 : 1) as never)

    const payload = await getSalesDashboard({ now: NOW }, USER)

    const row = payload.actions.find((r) => r.key === "tasks")!
    expect(row).toMatchObject({
      label: "Tasks due or overdue", count: 4, detail: "1 overdue", tone: "yellow", href: "/tasks?due=now",
    })
    const due = vi.mocked(prisma.salesTask.count).mock.calls
      .map(([args]: any[]) => args.where).find((where) => where.dueOn.lte)
    expect(due).toEqual({
      status: "PENDING", assignedToEmployeeId: { in: ["emp-2"] }, dueOn: { lte: new Date("2026-08-15T00:00:00.000Z") },
    })
  })

  it("says so in words when there are no meetings or tasks", async () => {
    const payload = await getSalesDashboard({ now: NOW }, USER)

    expect(payload.actions.find((r) => r.key === "meetings")?.detail).toBe("Nothing in the next 7 days")
    expect(payload.actions.find((r) => r.key === "tasks")?.detail).toBe("Nothing due today")
  })

  it("counts my completed meetings from the last 7 days that nobody has written minutes for", async () => {
    vi.mocked(prisma.salesMeeting.count).mockImplementation((async (args: any) =>
      args.where.status === "COMPLETED" ? 2 : 0) as never)

    const payload = await getSalesDashboard({ now: NOW }, USER)

    const row = payload.actions.find((r) => r.key === "minutes")!
    expect(row).toMatchObject({
      label: "Meetings with no minutes", count: 2, tone: "yellow", href: "/meetings/minutes",
    })
    expect(payload.badges["/meetings/minutes"]).toBe(2)
    const where = vi.mocked(prisma.salesMeeting.count).mock.calls
      .map(([args]: any[]) => args.where).find((w) => w.status === "COMPLETED")
    // NOW is noon on 15 Aug in Dhaka, so the window opens at the start of 9 Aug there.
    expect(where).toEqual({
      status: "COMPLETED",
      minutes: { is: null },
      scheduledAt: { gte: new Date("2026-08-08T18:00:00.000Z") },
      attendees: { some: { side: "OURS", employeeId: { in: ["emp-2"] } } },
    })
  })

  it("says so plainly when every recent meeting has its minutes", async () => {
    const payload = await getSalesDashboard({ now: NOW }, USER)

    expect(payload.actions.find((r) => r.key === "minutes")).toMatchObject({
      // The queue rule: nothing waiting is the healthy state.
      count: 0, detail: "Every meeting from the last 7 days has minutes", tone: "green",
    })
  })

  it("counts an account a completed meeting was on as worked on", async () => {
    vi.mocked(prisma.salesMeeting.findMany).mockResolvedValue([{ salesAccountId: "sa-9" }] as never)

    const payload = await getSalesDashboard({ now: NOW }, USER)

    expect(stat(payload, "Accounts Worked On")?.value).toBe("1")
    expect(prisma.salesMeeting.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: "COMPLETED", attendees: { some: { side: "OURS", employeeId: { in: ["emp-2"] } } },
      }),
    }))
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

  it("refuses a Sales User asking for the team roll-up", async () => {
    await expect(getSalesDashboard({ now: NOW, employeeId: "all" }, USER)).rejects.toMatchObject({
      statusCode: 403,
    })
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
    expect(closing?.where?.expectedCloseDate?.gte?.toISOString()).toBe("2026-08-15T00:00:00.000Z")
  })

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
})

describe("the team roll-up", () => {
  const PEOPLE = [
    { id: "emp-2", fullName: "Rahim", userId: "user-2" },
    { id: "emp-3", fullName: "Nasir", userId: "user-3" },
  ]

  it("names every person on its own row", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue(PEOPLE as never)

    const payload = await getSalesDashboard({ now: NOW, employeeId: "all" }, ADMIN)

    expect(payload.team?.map((row) => row.employeeName)).toEqual(["Rahim", "Nasir"])
  })

  it("works out each person's carried target first, then adds them up", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue(PEOPLE as never)
    // Rahim: 40L from Q1, won nothing in Q1 and 7L in Q2, so Q2 was 10L + 10L
    // and Q3 is 10L + 13L. Nasir: 20L from Q3, so Q3 is 10L and nothing carries.
    vi.mocked(prisma.salesTarget.findMany).mockResolvedValue([
      RAHIM_TARGET,
      { employeeId: "emp-3", amount: dec("2000000.00"), startQuarter: 3, note: null },
    ] as never)
    deals({ won: [{ wonByEmployeeId: "emp-2", amount: "700000.00", closedAt: "2026-05-10T06:00:00.000Z" }] })

    const payload = await getSalesDashboard({ now: NOW, employeeId: "all" }, ADMIN)

    expect(payload.team?.map((row) => row.target)).toEqual(["2300000.00", "1000000.00"])
    expect(stat(payload, "Team Target")?.value).toBe(bdt(dec("3300000.00")))
    expect(stat(payload, "Team Yearly Target")?.value).toBe(bdt(dec("6000000.00")))
    // Rahim's only win was in Q2, so nobody has won a deal this quarter.
    expect(stat(payload, "Team Deals Won")?.value).toBe("0")
  })

  it("gives an admin both bands, not a stripped payload", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([PEOPLE[0]] as never)

    const payload = await getSalesDashboard({ now: NOW, employeeId: "all" }, ADMIN)

    expect(payload.quarters.map((q) => q.quarter)).toEqual([1, 2, 3, 4])
    expect(payload.actions.map((row) => row.key))
      .toEqual(["meetings", "tasks", "minutes", "weekly", "closing", "unverified", "quiet", "stuck"])
    expect(Object.keys(payload.badges)).toHaveLength(7)
  })

  it("takes the documented employeeId=all rather than a second spelling", async () => {
    const payload = await getSalesDashboard({ now: NOW, employeeId: "all" }, ADMIN)
    expect(payload.scope).toBe("all")
  })
})

// The weekly report's own row (revision §26.16). A Sales User sees where
// their week stands; an admin sees how many of last week's are missing.
describe("the weekly report row", () => {
  beforeEach(() => {
    vi.mocked(prisma.weeklyReport.findUnique).mockResolvedValue(null as never)
    vi.mocked(prisma.weeklyReport.count).mockResolvedValue(0 as never)
    vi.mocked(prisma.employee.count).mockResolvedValue(0 as never)
  })

  it("tells a Sales User their week has not been started, and shows no badge", async () => {
    const payload = await getSalesDashboard({ now: NOW }, USER)

    expect(payload.actions.find((row) => row.key === "weekly")).toMatchObject({
      label: "This week's report",
      detail: "Not started",
      count: 0,
      href: "/weekly",
    })
    // No badge for a writer: the row says where the week stands, and a
    // number beside the menu item would read as a queue of work.
    expect(payload.badges["/weekly"]).toBe(0)
  })

  it("says when a Sales User's week is a draft, and when it is submitted", async () => {
    vi.mocked(prisma.weeklyReport.findUnique).mockResolvedValue({ status: "DRAFT" } as never)
    expect((await getSalesDashboard({ now: NOW }, USER)).actions.find((r) => r.key === "weekly")).toMatchObject({
      detail: "Draft",
    })

    vi.mocked(prisma.weeklyReport.findUnique).mockResolvedValue({ status: "SUBMITTED" } as never)
    expect((await getSalesDashboard({ now: NOW }, USER)).actions.find((r) => r.key === "weekly")).toMatchObject({
      detail: "Submitted",
    })
  })

  it("counts last week's missing reports for an admin, and badges them", async () => {
    vi.mocked(prisma.employee.count).mockResolvedValue(5 as never)
    vi.mocked(prisma.weeklyReport.count).mockResolvedValue(2 as never)

    const payload = await getSalesDashboard({ now: NOW }, ADMIN)

    expect(payload.actions.find((row) => row.key === "weekly")).toMatchObject({
      label: "Last week's reports not submitted",
      count: 3,
      tone: "yellow",
      href: "/weekly/all",
    })
    expect(payload.badges["/weekly/all"]).toBe(3)
  })

  it("says so plainly when every report for last week is in", async () => {
    vi.mocked(prisma.employee.count).mockResolvedValue(4 as never)
    vi.mocked(prisma.weeklyReport.count).mockResolvedValue(4 as never)

    expect((await getSalesDashboard({ now: NOW }, ADMIN)).actions.find((r) => r.key === "weekly")).toMatchObject({
      count: 0,
      detail: "Everybody sent last week's report",
      tone: "green",
    })
  })
})
