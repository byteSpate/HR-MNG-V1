import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./dashboard.service", () => ({ getDashboard: vi.fn() }))

import app from "../../app"
import { Role } from "../../generated/prisma/client"
import { signAccessToken } from "../auth/auth.utils"
import { getDashboard } from "./dashboard.service"

const auth = (role: Role) =>
  `Bearer ${signAccessToken({ sub: "user-1", role, email: "a@demo.com", mustChangePassword: false, salesRole: null })}`

beforeEach(() => {
  // Echoes back whatever role the service was handed, so the route tests are
  // about dispatch rather than about any one payload's contents.
  vi.mocked(getDashboard).mockImplementation(async (actor) => ({
    role: actor.role,
    greeting: { kicker: "Good morning", heading: "H", sub: "S", cta: { label: "L", href: "/" } },
    stats: [],
    badges: {},
  }))
})

afterEach(() => vi.clearAllMocks())

describe("GET /api/dashboard", () => {
  it("401s unauthenticated", async () => {
    expect((await request(app).get("/api/dashboard")).status).toBe(401)
  })

  // Driven from the enum, not a hand-written list: a sixth role should fail
  // this test rather than silently return an empty payload.
  it.each(Object.values(Role))("gives %s a payload for its own role", async (role) => {
    const res = await request(app).get("/api/dashboard").set("Authorization", auth(role))

    expect(res.status).toBe(200)
    expect(res.body.role).toBe(role)
  })

  it("ignores a role query parameter rather than rejecting it", async () => {
    // Ignored, not rejected: a 400 would imply the parameter is meaningful,
    // and the next reader would go looking for where it is honoured.
    const res = await request(app)
      .get("/api/dashboard?role=SUPER_ADMIN")
      .set("Authorization", auth(Role.EMPLOYEE))

    expect(res.status).toBe(200)
    expect(res.body.role).toBe("EMPLOYEE")
    expect(vi.mocked(getDashboard).mock.calls[0][0].role).toBe("EMPLOYEE")
  })

  it("takes the role from the token, never from the request", async () => {
    await request(app)
      .get("/api/dashboard")
      .set("Authorization", auth(Role.HR_ADMIN))
      .set("X-Role", "SUPER_ADMIN")

    expect(vi.mocked(getDashboard).mock.calls[0][0].role).toBe("HR_ADMIN")
  })

  it("500s through errorHandler with the standard shape when a builder throws", async () => {
    // Whole-payload failure. Per-card failure is a different mechanism and
    // must never reach here.
    vi.mocked(getDashboard).mockRejectedValue(new Error("boom"))

    const res = await request(app).get("/api/dashboard").set("Authorization", auth(Role.HR_ADMIN))
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: "Internal server error" })
  })

  it("has no role gate — every role reaches the same handler", async () => {
    for (const role of Object.values(Role)) {
      const res = await request(app).get("/api/dashboard").set("Authorization", auth(role))
      expect(res.status).not.toBe(403)
    }
  })
})
