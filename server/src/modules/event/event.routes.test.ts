import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

// The real service, against a mocked Prisma — the point of this file is that
// the *route* cannot escape the visibility filter, which a mocked service
// would prove nothing about.
vi.mock("../../config/prisma", () => ({
  default: {
    employee: { findUnique: vi.fn() },
    event: { findMany: vi.fn() },
  },
}))

import app from "../../app"
import prisma from "../../config/prisma"
import { signAccessToken } from "../auth/auth.utils"

type TestRole = "EMPLOYEE" | "REPORTING_MANAGER" | "HR_ADMIN" | "SUPER_ADMIN" | "FINANCE_OFFICER"
const auth = (role: TestRole, sub = "user-1") =>
  `Bearer ${signAccessToken({ sub, role: role as never, email: "a@demo.com", mustChangePassword: false, salesRole: null })}`

/** Rows a fake database holds, filtered in memory by the where Prisma got. */
const ROWS = [
  {
    id: "evt-own",
    type: "leave.approved",
    severity: "SUCCESS",
    entity: "LEAVE_REQUEST",
    entityId: "lr-1",
    title: "Casual leave approved",
    meta: null,
    href: "/leave",
    createdAt: new Date("2026-08-01T10:00:00.000Z"),
    subjectEmployeeId: "emp-1",
    managerEmployeeId: "emp-mgr",
    audienceDepartmentId: null,
    targetRoles: [],
    companyWide: false,
  },
  {
    id: "evt-peer",
    type: "leave.rejected",
    severity: "WARNING",
    entity: "LEAVE_REQUEST",
    entityId: "lr-2",
    title: "Casual leave rejected",
    meta: null,
    href: "/leave",
    createdAt: new Date("2026-08-01T11:00:00.000Z"),
    subjectEmployeeId: "emp-2",
    managerEmployeeId: "emp-other",
    audienceDepartmentId: null,
    targetRoles: [],
    companyWide: false,
  },
  {
    id: "evt-all",
    type: "announcement.published",
    severity: "INFO",
    entity: "ANNOUNCEMENT",
    entityId: "ann-1",
    title: "Office closed on Sunday",
    meta: "New announcement",
    href: "/announcements",
    createdAt: new Date("2026-08-01T12:00:00.000Z"),
    subjectEmployeeId: null,
    managerEmployeeId: null,
    audienceDepartmentId: null,
    targetRoles: [],
    companyWide: true,
    payload: { publishAt: "2026-07-31T00:00:00.000Z" },
  },
  {
    id: "evt-run",
    type: "payroll.run.submitted",
    severity: "WARNING",
    entity: "PAYROLL_RUN",
    entityId: "run-1",
    title: "July 2026 payroll submitted for approval",
    meta: null,
    href: "/payroll",
    createdAt: new Date("2026-08-01T13:00:00.000Z"),
    subjectEmployeeId: null,
    managerEmployeeId: null,
    audienceDepartmentId: null,
    targetRoles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
    companyWide: false,
  },
]

type Row = (typeof ROWS)[number]

/** Applies just enough of the `where` to prove the route is scoped. */
function fakeFindMany({ where, take }: { where?: any; take?: number }) {
  const visibility = where.AND[0]
  const entityClauses = where.AND.slice(2)

  const matched = ROWS.filter((row: Row) => {
    const seen = visibility.OR.some((clause: any) => {
      if ("companyWide" in clause) return row.companyWide
      if ("subjectEmployeeId" in clause) return row.subjectEmployeeId === clause.subjectEmployeeId
      if ("managerEmployeeId" in clause) return row.managerEmployeeId === clause.managerEmployeeId
      if ("audienceDepartmentId" in clause)
        return row.audienceDepartmentId === clause.audienceDepartmentId
      if ("targetRoles" in clause)
        return (row.targetRoles as string[]).includes(clause.targetRoles.has)
      return false
    })
    if (!seen) return false
    return entityClauses.every((clause: Record<string, unknown>) =>
      Object.entries(clause).every(([k, v]) => (row as Record<string, unknown>)[k] === v)
    )
  })
  return Promise.resolve(matched.slice(0, take))
}

beforeEach(() => {
  vi.mocked(prisma.event.findMany).mockImplementation(fakeFindMany as never)
})

afterEach(() => vi.clearAllMocks())

describe("GET /api/events", () => {
  function asEmployee(id: string, departmentId: string | null = "dept-eng") {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id, departmentId } as never)
  }

  it("401s unauthenticated", async () => {
    expect((await request(app).get("/api/events")).status).toBe(401)
  })

  it("gives an employee their own events and the company-wide one", async () => {
    asEmployee("emp-1")
    const res = await request(app).get("/api/events").set("Authorization", auth("EMPLOYEE"))

    expect(res.status).toBe(200)
    expect(res.body.items.map((i: any) => i.id).sort()).toEqual(["evt-all", "evt-own"])
  })

  it("does not give one employee another's events", async () => {
    asEmployee("emp-1")
    const res = await request(app).get("/api/events").set("Authorization", auth("EMPLOYEE"))
    expect(res.body.items.map((i: any) => i.id)).not.toContain("evt-peer")
  })

  it("gives a second employee a different feed, overlapping only on companyWide", async () => {
    asEmployee("emp-2", "dept-fin")
    const res = await request(app)
      .get("/api/events")
      .set("Authorization", auth("EMPLOYEE", "user-2"))

    expect(res.body.items.map((i: any) => i.id).sort()).toEqual(["evt-all", "evt-peer"])
  })

  it("gives a manager their report's event but not the payroll run", async () => {
    asEmployee("emp-mgr")
    const res = await request(app).get("/api/events").set("Authorization", auth("REPORTING_MANAGER"))

    const ids = res.body.items.map((i: any) => i.id)
    expect(ids).toContain("evt-own")
    expect(ids).not.toContain("evt-run")
  })

  it("gives Finance the payroll run, and not an employee's leave rejection", async () => {
    // The explicit negative for "no blanket admin visibility".
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null as never)
    const res = await request(app).get("/api/events").set("Authorization", auth("FINANCE_OFFICER"))

    const ids = res.body.items.map((i: any) => i.id)
    expect(ids).toContain("evt-run")
    expect(ids).not.toContain("evt-peer")
  })

  it("returns an empty list, not a 403, for a run the caller cannot see", async () => {
    // A 403 would confirm the id exists, which is itself a disclosure.
    asEmployee("emp-1")
    const res = await request(app)
      .get("/api/events?entity=PAYROLL_RUN&entityId=run-1")
      .set("Authorization", auth("EMPLOYEE"))

    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([])
  })

  it("returns that run's timeline to somebody who may see it", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null as never)
    const res = await request(app)
      .get("/api/events?entity=PAYROLL_RUN&entityId=run-1")
      .set("Authorization", auth("SUPER_ADMIN"))

    expect(res.body.items.map((i: any) => i.id)).toEqual(["evt-run"])
  })

  it("400s a limit above the cap rather than silently serving it", async () => {
    asEmployee("emp-1")
    const res = await request(app).get("/api/events?limit=5000").set("Authorization", auth("EMPLOYEE"))
    expect(res.status).toBe(400)
  })

  it("400s a non-numeric limit", async () => {
    asEmployee("emp-1")
    const res = await request(app).get("/api/events?limit=abc").set("Authorization", auth("EMPLOYEE"))
    expect(res.status).toBe(400)
  })

  it("never returns the audience columns or the payload", async () => {
    asEmployee("emp-1")
    const res = await request(app).get("/api/events").set("Authorization", auth("EMPLOYEE"))

    for (const item of res.body.items) {
      expect(item).not.toHaveProperty("subjectEmployeeId")
      expect(item).not.toHaveProperty("targetRoles")
      expect(item).not.toHaveProperty("payload")
    }
  })

  it("pages without duplicating rows that share a createdAt", async () => {
    // Two events emitted in one transaction share a timestamp, so ordering on
    // createdAt alone would repeat one across the page boundary.
    const sameInstant = new Date("2026-08-01T10:00:00.000Z")
    const shared = ROWS.slice(0, 3).map((r) => ({ ...r, createdAt: sameInstant, companyWide: true }))
    vi.mocked(prisma.event.findMany).mockImplementation((async ({ take, cursor }: any) => {
      const start = cursor ? shared.findIndex((r) => r.id === cursor.id) + 1 : 0
      return shared.slice(start, start + take)
    }) as never)
    asEmployee("emp-1")

    const first = await request(app).get("/api/events?limit=2").set("Authorization", auth("EMPLOYEE"))
    expect(first.body.items.map((i: any) => i.id)).toEqual(["evt-own", "evt-peer"])
    expect(first.body.nextCursor).toBe("evt-peer")

    const second = await request(app)
      .get(`/api/events?limit=2&cursor=${first.body.nextCursor}`)
      .set("Authorization", auth("EMPLOYEE"))

    expect(second.body.items.map((i: any) => i.id)).toEqual(["evt-all"])
    expect(second.body.nextCursor).toBeNull()
  })
})
