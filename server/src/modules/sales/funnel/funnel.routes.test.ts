import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

/**
 * The funnel over HTTP: who is turned away at the door, and what is refused
 * before any service runs. Everything here is decided by the router and the
 * validators, so nothing below the prisma singleton needs to answer.
 */
vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    user: { findUnique: vi.fn() },
    employee: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), groupBy: vi.fn() },
    opportunity: { findMany: vi.fn(), findFirst: vi.fn(), groupBy: vi.fn() },
    funnelMeeting: { findUnique: vi.fn() },
    salesComment: { findMany: vi.fn() },
  },
}))

import app from "../../../app"
import prisma from "../../../config/prisma"
import { signAccessToken } from "../../auth/auth.utils"

type Actor = {
  role: "EMPLOYEE" | "SUPER_ADMIN"
  salesRole: "SALES_ADMIN" | "SALES_USER" | null
}

const auth = ({ role, salesRole }: Actor) =>
  `Bearer ${signAccessToken({
    sub: "user-1",
    role: role as never,
    email: "actor@demo.com",
    mustChangePassword: false,
    salesRole: salesRole as never,
  })}`

const USER: Actor = { role: "EMPLOYEE", salesRole: "SALES_USER" }
const ADMIN: Actor = { role: "EMPLOYEE", salesRole: "SALES_ADMIN" }
const OUTSIDER: Actor = { role: "EMPLOYEE", salesRole: null }

const ID = "11111111-1111-4111-8111-111111111111"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("the admin-only routes turn a Sales User away", () => {
  const cases: [string, string, string][] = [
    ["get", "/api/sales/funnel/team", "the team list"],
    ["get", "/api/sales/funnel/meeting", "reading the meeting"],
    ["post", "/api/sales/funnel/meeting", "opening the meeting"],
    ["put", `/api/sales/funnel/meeting/${ID}/attendees`, "ticking attendees"],
    ["put", `/api/sales/funnel/meeting/${ID}/reviewed`, "marking somebody reviewed"],
    ["put", `/api/sales/funnel/meeting/${ID}/note`, "the week note"],
    ["post", `/api/sales/funnel/meeting/${ID}/complete`, "completing"],
    ["post", `/api/sales/funnel/meeting/${ID}/reopen`, "reopening"],
    ["post", `/api/sales/funnel/meeting/${ID}/actions`, "giving an action item"],
    ["get", `/api/sales/funnel/meeting/${ID}/actions`, "listing action items"],
    ["post", `/api/sales/funnel/meeting/${ID}/notes`, "a management note"],
  ]

  it.each(cases)("%s %s (%s)", async (method, path) => {
    const res = await (request(app) as never as Record<string, (p: string) => request.Test>)
      [method](path)
      .set("Authorization", auth(USER))
      .send({})
    expect(res.status).toBe(403)
  })
})

describe("somebody with no Sales Hub role is turned away from all of it", () => {
  it.each(["/api/sales/funnel", "/api/sales/funnel/team", "/api/sales/funnel/meeting"])(
    "GET %s",
    async (path) => {
      await request(app).get(path).set("Authorization", auth(OUTSIDER)).expect(403)
    }
  )

  it("PATCH /cell", async () => {
    await request(app)
      .patch("/api/sales/funnel/cell")
      .set("Authorization", auth(OUTSIDER))
      .send({ opportunityId: ID, edit: { field: "useCase", value: "x" } })
      .expect(403)
  })
})

describe("nobody without a token gets in", () => {
  it("answers 401", async () => {
    await request(app).get("/api/sales/funnel").expect(401)
    await request(app).patch("/api/sales/funnel/cell").send({}).expect(401)
  })
})

describe("a bad date is a 400, not a 500", () => {
  it("refuses a date that does not exist when opening a meeting", async () => {
    const res = await request(app)
      .post("/api/sales/funnel/meeting")
      .set("Authorization", auth(ADMIN))
      .send({ weekStart: "2026-02-30" })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/real calendar date/)
  })

  it("refuses a week that does not start on a Sunday", async () => {
    // 2026-09-16 is a Wednesday. A meeting dated so would defeat the one
    // review per week rule and never be found by the team list.
    const res = await request(app)
      .post("/api/sales/funnel/meeting")
      .set("Authorization", auth(ADMIN))
      .send({ weekStart: "2026-09-16" })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Sunday/)
  })

  it("validates the weekStart on a meeting lookup too", async () => {
    await request(app)
      .get("/api/sales/funnel/meeting?weekStart=not-a-date")
      .set("Authorization", auth(ADMIN))
      .expect(400)
    await request(app)
      .get("/api/sales/funnel/meeting?weekStart=2026-09-16")
      .set("Authorization", auth(ADMIN))
      .expect(400)
  })

  it("refuses an impossible date typed into a cell", async () => {
    const res = await request(app)
      .patch("/api/sales/funnel/cell")
      .set("Authorization", auth(USER))
      .send({ opportunityId: ID, edit: { field: "expectedCloseDate", value: "2026-13-01" } })
    expect(res.status).toBe(400)
    expect(prisma.opportunity.findFirst).not.toHaveBeenCalled()
  })

  it("refuses an impossible due date on an action item", async () => {
    await request(app)
      .post(`/api/sales/funnel/meeting/${ID}/actions`)
      .set("Authorization", auth(ADMIN))
      .send({ assignedToEmployeeId: ID, title: "Chase it", dueOn: "2026-02-30" })
      .expect(400)
  })
})

describe("a cell edit", () => {
  it("cannot clear the offer date, which is what keeps a deal in the funnel", async () => {
    const res = await request(app)
      .patch("/api/sales/funnel/cell")
      .set("Authorization", auth(USER))
      .send({ opportunityId: ID, edit: { field: "offeredOn", value: null } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/cannot be cleared/)
    expect(prisma.opportunity.findFirst).not.toHaveBeenCalled()
  })

  it("only takes a field on the closed list — status is not one", async () => {
    await request(app)
      .patch("/api/sales/funnel/cell")
      .set("Authorization", auth(USER))
      .send({ opportunityId: ID, edit: { field: "status", value: "WON" } })
      .expect(400)
    await request(app)
      .patch("/api/sales/funnel/cell")
      .set("Authorization", auth(USER))
      .send({ opportunityId: ID, edit: { field: "ownerEmployeeId", value: ID } })
      .expect(400)
  })
})
