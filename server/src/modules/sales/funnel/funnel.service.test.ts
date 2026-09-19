import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/env", () => ({ env: { APP_TIMEZONE: "Asia/Dhaka" } }))

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    employee: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    opportunity: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), groupBy: vi.fn() },
    salesComment: { findMany: vi.fn(), create: vi.fn() },
    auditLog: { findMany: vi.fn(), create: vi.fn() },
    funnelMeeting: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    salesTask: { findMany: vi.fn(), create: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}))

import prisma from "../../../config/prisma"
import { closeChangesFrom, FUNNEL_NOT_YOURS, getFunnel, listFunnelTeam } from "./funnel.service"

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const day = (value: string) => new Date(`${value}T00:00:00.000Z`)

const USER = {
  sub: "user-1",
  role: "EMPLOYEE",
  email: "rahim@example.com",
  mustChangePassword: false,
  salesRole: "SALES_USER",
} as never

const ADMIN = {
  sub: "user-2",
  role: "EMPLOYEE",
  email: "admin@example.com",
  mustChangePassword: false,
  salesRole: "SALES_ADMIN",
} as never

const QUERY = {
  sort: "offeredOn" as const,
  direction: "desc" as const,
  limit: 200,
  hideClosed: false,
  changedLastWeek: false,
}

const DEAL = {
  id: "opp-1",
  serial: "BS-OPP-00001",
  salesAccountId: "acc-1",
  salesAccount: { name: "Example Bank" },
  name: "Campus core refresh",
  useCase: null,
  offeredOn: day("2026-09-05"),
  amount: "100.00",
  status: "ONGOING",
  stage: "QUOTATION_SUBMITTED",
  expectedCloseDate: day("2026-10-15"),
  lostToPartner: null,
  lostToAmount: null,
  lostToProduct: null,
  nextStep: null,
  lines: [],
}

const dealArgs = () => mocked(prisma.opportunity.findMany).mock.calls[0][0]

beforeEach(() => {
  vi.clearAllMocks()
  // employeeIdFor reads the user's employee record.
  mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } })
  mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-1", fullName: "Rahim Uddin" })
  mocked(prisma.opportunity.findMany).mockResolvedValue([DEAL])
  mocked(prisma.salesComment.findMany).mockResolvedValue([])
  mocked(prisma.auditLog.findMany).mockResolvedValue([])
})

describe("getFunnel: who may see whose", () => {
  it("gives a Sales User their own funnel without being asked for an id", async () => {
    const grid = await getFunnel(QUERY as never, USER)
    expect(grid.employeeId).toBe("emp-1")
    expect(dealArgs().where.ownerEmployeeId).toBe("emp-1")
  })

  it("refuses a Sales User asking for somebody else's funnel", async () => {
    await expect(getFunnel({ ...QUERY, employeeId: "emp-2" } as never, USER)).rejects.toMatchObject({
      statusCode: 403,
      message: FUNNEL_NOT_YOURS,
    })
  })

  it("lets a Sales Admin open anyone's", async () => {
    mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-2", fullName: "Karim Ahmed" })
    const grid = await getFunnel({ ...QUERY, employeeId: "emp-2" } as never, ADMIN)
    expect(grid.employeeId).toBe("emp-2")
  })
})

describe("getFunnel: membership and filters", () => {
  it("only ever asks for deals that have been quoted", async () => {
    // Funnel membership is offeredOn being set, and it never comes off
    // (§27.2). A deal still in Requirement received must not appear.
    await getFunnel(QUERY as never, USER)
    expect(dealArgs().where.offeredOn).toEqual({ not: null })
  })

  it("keeps Lost and Cancelled deals unless asked to hide them", async () => {
    await getFunnel(QUERY as never, USER)
    expect(dealArgs().where.status).toBeUndefined()
  })

  it("hides closed deals when asked, and that beats a status filter", async () => {
    // Asking for LOST and also to hide closed deals is a contradiction. The
    // narrower answer is the safer one.
    await getFunnel({ ...QUERY, status: "LOST", hideClosed: true } as never, USER)
    expect(dealArgs().where.status).toEqual({ notIn: ["LOST", "CANCELLED"] })
  })

  it("filters on recent activity as an instant, not a date", async () => {
    const now = new Date("2026-09-19T09:00:00.000Z")
    await getFunnel({ ...QUERY, changedLastWeek: true } as never, USER, now)
    expect(dealArgs().where.lastActivityAt.gte.toISOString()).toBe("2026-09-12T09:00:00.000Z")
  })

  it("always bounds the read", async () => {
    // The funnel is a list that only grows. An unbounded read here would be
    // the same defect the performance audit found in 191 other places.
    await getFunnel(QUERY as never, USER)
    expect(dealArgs().take).toBe(200)
  })
})

describe("getFunnel: sorting happens in the database", () => {
  it("sorts by offer date, newest first, with a stable second key", async () => {
    await getFunnel(QUERY as never, USER)
    expect(dealArgs().orderBy).toEqual([{ offeredOn: "desc" }, { serial: "asc" }])
  })

  it("sorts by the account's name through the relation", async () => {
    await getFunnel({ ...QUERY, sort: "account", direction: "asc" } as never, USER)
    expect(dealArgs().orderBy[0]).toEqual({ salesAccount: { name: "asc" } })
  })
})

describe("getFunnel: management notes", () => {
  it("does not let a Sales User's read pull back a management note", async () => {
    // A `where`, not a filter over fetched rows: a caller who may not read one
    // must not cause it to be read.
    await getFunnel(QUERY as never, USER)
    const where = mocked(prisma.salesComment.findMany).mock.calls[0][0].where
    expect(where.kind).toEqual({ not: "MANAGEMENT_NOTE" })
  })

  it("places no such restriction on an admin", async () => {
    await getFunnel(QUERY as never, ADMIN)
    const where = mocked(prisma.salesComment.findMany).mock.calls[0][0].where
    expect(where.kind).toBeUndefined()
  })
})

describe("getFunnel: an empty funnel reads nothing extra", () => {
  it("skips the comment and audit queries when there are no deals", async () => {
    mocked(prisma.opportunity.findMany).mockResolvedValue([])
    const grid = await getFunnel(QUERY as never, USER)

    expect(grid.rows).toEqual([])
    expect(grid.totals.quoted).toBe("0.00")
    expect(prisma.salesComment.findMany).not.toHaveBeenCalled()
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled()
  })
})

describe("closeChangesFrom", () => {
  it("keeps only the audit rows that touched the closing date", () => {
    const changes = closeChangesFrom([
      {
        entityId: "opp-1",
        before: { amount: "1.00" },
        after: { amount: "2.00" },
        changedAt: new Date("2026-09-01T10:00:00.000Z"),
      },
      {
        entityId: "opp-1",
        before: { expectedCloseDate: "2026-09-30T00:00:00.000Z" },
        after: { expectedCloseDate: "2026-10-15T00:00:00.000Z" },
        changedAt: new Date("2026-09-10T10:00:00.000Z"),
      },
    ])
    expect(changes).toHaveLength(1)
    expect(changes[0].from?.toISOString()).toBe("2026-09-30T00:00:00.000Z")
    expect(changes[0].to?.toISOString()).toBe("2026-10-15T00:00:00.000Z")
  })

  it("survives an audit row whose value is not a date string", () => {
    // The audit log is written by many modules over years. A reader that
    // throws on one odd row takes the whole grid down with it.
    const changes = closeChangesFrom([
      {
        entityId: "opp-1",
        before: { expectedCloseDate: null },
        after: { expectedCloseDate: "not a date" },
        changedAt: new Date("2026-09-10T10:00:00.000Z"),
      },
    ])
    expect(changes).toHaveLength(1)
    expect(changes[0].from).toBeNull()
    expect(changes[0].to).toBeNull()
  })
})

describe("listFunnelTeam", () => {
  beforeEach(() => {
    mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "emp-1", fullName: "Rahim Uddin" },
      { id: "emp-2", fullName: "Karim Ahmed" },
    ])
    mocked(prisma.opportunity.groupBy)
      .mockResolvedValueOnce([
        { ownerEmployeeId: "emp-1", _count: { _all: 3 }, _sum: { amount: "300.00" } },
      ])
      .mockResolvedValueOnce([{ ownerEmployeeId: "emp-1", _sum: { amount: "200.00" } }])
    mocked(prisma.funnelMeeting.findUnique).mockResolvedValue({
      reviews: [{ employeeId: "emp-1" }],
    })
  })

  it("is refused to a Sales User", async () => {
    await expect(listFunnelTeam(USER)).rejects.toMatchObject({ statusCode: 403 })
  })

  it("lists everyone in the hub, including people with no quoted deals", async () => {
    // A person with an empty funnel is the one the admin most needs to see.
    // Dropping them would hide exactly the problem the meeting exists for.
    const result = await listFunnelTeam(ADMIN, new Date("2026-09-19T09:00:00.000Z"))
    expect(result.rows.map((r) => r.employeeName)).toEqual(["Rahim Uddin", "Karim Ahmed"])
    expect(result.rows[1].dealCount).toBe(0)
    expect(result.rows[1].quoted).toBe("0.00")
  })

  it("carries both totals and the reviewed tick", async () => {
    const result = await listFunnelTeam(ADMIN, new Date("2026-09-19T09:00:00.000Z"))
    expect(result.rows[0]).toMatchObject({
      dealCount: 3,
      quoted: "300.00",
      stillOpen: "200.00",
      reviewed: true,
    })
    expect(result.rows[1].reviewed).toBe(false)
  })

  it("names the week being reviewed, not the week we are in", async () => {
    // Saturday 19 Sep reviews the week whose Sunday is 13 Sep.
    const result = await listFunnelTeam(ADMIN, new Date("2026-09-19T09:00:00.000Z"))
    expect(result.weekStart).toBe("2026-09-13")
  })

  it("aggregates in the database rather than fetching every deal", async () => {
    await listFunnelTeam(ADMIN, new Date("2026-09-19T09:00:00.000Z"))
    expect(prisma.opportunity.groupBy).toHaveBeenCalledTimes(2)
    expect(prisma.opportunity.findMany).not.toHaveBeenCalled()
  })
})
