import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("../../config/prisma", () => ({
  default: { user: { update: vi.fn() }, refreshToken: { updateMany: vi.fn() } },
}))

vi.mock("./user.service", () => ({
  listUsers: vi.fn(async () => []),
  createUser: vi.fn(async () => ({
    id: "u-9",
    email: "new@demo.com",
    role: "HR_ADMIN",
    temporaryPassword: "TempPass123",
  })),
  setUserStatus: vi.fn(async () => ({
    id: "u2",
    email: "b@c.com",
    role: "HR_ADMIN",
    isActive: false,
    mustChangePassword: false,
    createdAt: "2026-01-05T00:00:00.000Z",
    employee: null,
  })),
  setUserRole: vi.fn(async () => ({
    id: "u2",
    email: "b@c.com",
    role: "FINANCE_OFFICER",
    isActive: true,
    mustChangePassword: false,
    createdAt: "2026-01-05T00:00:00.000Z",
    employee: null,
  })),
}))

import app from "../../app"
import { AppError } from "../../middleware/errorHandler"
import { signAccessToken } from "./auth.utils"
import { setUserRole, setUserStatus } from "./user.service"

function tokenFor(role: "SUPER_ADMIN" | "EMPLOYEE" | "HR_ADMIN") {
  return signAccessToken({ sub: "actor-1", role: role as any, email: "actor@b.com", mustChangePassword: false, salesRole: null })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("PATCH /api/users/:id/status", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await request(app).patch("/api/users/u2/status").send({ isActive: false })
    expect(res.status).toBe(401)
  })

  it("returns 403 for a non-Super-Admin caller", async () => {
    const res = await request(app)
      .patch("/api/users/u2/status")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
      .send({ isActive: false })
    expect(res.status).toBe(403)
  })

  // Token revocation, the 404 and the guards moved into user.service when
  // this handler was made to delegate; user.service.test.ts owns them now.
  // What is left to assert here is the wiring.
  it("returns 200 and passes the CALLER's id through, so the self-guard can fire", async () => {
    const res = await request(app)
      .patch("/api/users/u2/status")
      .set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)
      .send({ isActive: false })

    expect(res.status).toBe(200)
    expect(res.body.isActive).toBe(false)
    // The guard is useless if the route drops the actor.
    expect(setUserStatus).toHaveBeenCalledWith("actor-1", "u2", false)
  })

  it("passes true straight through when reactivating", async () => {
    const res = await request(app)
      .patch("/api/users/u2/status")
      .set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)
      .send({ isActive: true })

    expect(res.status).toBe(200)
    expect(setUserStatus).toHaveBeenCalledWith("actor-1", "u2", true)
  })

  it("returns 400 for a malformed body", async () => {
    const res = await request(app)
      .patch("/api/users/u2/status")
      .set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)
      .send({ isActive: "not-a-boolean" })
    expect(res.status).toBe(400)
  })

  it("surfaces the service's 404 for an unknown user id", async () => {
    vi.mocked(setUserStatus).mockRejectedValueOnce(new AppError(404, "User not found"))
    const res = await request(app)
      .patch("/api/users/unknown-id/status")
      .set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)
      .send({ isActive: false })
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: "User not found" })
  })
})

describe("GET /api/users", () => {
  it("200s for a SUPER_ADMIN", async () => {
    const res = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it("403s for HR_ADMIN — account administration is not HR's surface", async () => {
    const res = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${tokenFor("HR_ADMIN")}`)

    expect(res.status).toBe(403)
  })

  it("401s without a token", async () => {
    const res = await request(app).get("/api/users")

    expect(res.status).toBe(401)
  })
})

describe("POST /api/users", () => {
  it("201s and returns the temporary password once", async () => {
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)
      .send({ email: "new@demo.com", role: "HR_ADMIN" })

    expect(res.status).toBe(201)
    expect(res.body.temporaryPassword).toBe("TempPass123")
    expect(res.body).not.toHaveProperty("passwordHash")
  })

  it("400s on an employee-tier role — those need POST /api/employees/staff", async () => {
    // An EMPLOYEE account with no Employee row breaks employeeIdForUser,
    // which leave, insights and attendance all resolve callers through.
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)
      .send({ email: "new@demo.com", role: "EMPLOYEE" })

    expect(res.status).toBe(400)
  })

  it("400s on a malformed email", async () => {
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)
      .send({ email: "not-an-email", role: "HR_ADMIN" })

    expect(res.status).toBe(400)
  })

  it("accepts a pasted email with padding and case, rather than 400ing on it", async () => {
    // Regression: the schema read `.email().trim().toLowerCase()`, and Zod
    // applies those in order — so validation ran on the padded string and
    // rejected it as a malformed body instead of normalising it.
    const { createUser } = await import("./user.service")

    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)
      .send({ email: "  Bob@X.com  ", role: "HR_ADMIN" })

    expect(res.status).toBe(201)
    expect(createUser).toHaveBeenCalledWith({ email: "bob@x.com", role: "HR_ADMIN" })
  })

  it("403s for HR_ADMIN", async () => {
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${tokenFor("HR_ADMIN")}`)
      .send({ email: "new@demo.com", role: "HR_ADMIN" })

    expect(res.status).toBe(403)
  })
})

describe("PATCH /api/users/:id/role", () => {
  it("200s for a SUPER_ADMIN and passes the actor through", async () => {
    const res = await request(app)
      .patch("/api/users/u2/role")
      .set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)
      .send({ role: "FINANCE_OFFICER" })

    expect(res.status).toBe(200)
    expect(setUserRole).toHaveBeenCalledWith("actor-1", "u2", "FINANCE_OFFICER")
  })

  it("400s on a role outside the enum", async () => {
    const res = await request(app)
      .patch("/api/users/u2/role")
      .set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)
      .send({ role: "WIZARD" })

    expect(res.status).toBe(400)
  })

  it("403s for HR_ADMIN", async () => {
    const res = await request(app)
      .patch("/api/users/u2/role")
      .set("Authorization", `Bearer ${tokenFor("HR_ADMIN")}`)
      .send({ role: "FINANCE_OFFICER" })

    expect(res.status).toBe(403)
  })
})
