import { describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./auth.service", () => ({
  loginAdmin: vi.fn(),
  loginStaff: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  changePassword: vi.fn(),
}))

import app from "../../app"
import * as authService from "./auth.service"
import { signAccessToken } from "./auth.utils"

const publicUser = {
  id: "u1",
  email: "a@b.com",
  role: "SUPER_ADMIN" as any,
  isActive: true,
  mustChangePassword: false,
  salesRole: null,
}

describe("POST /api/auth/login (administrative)", () => {
  it("returns 200, sets a refreshToken cookie, and returns the access token + user", async () => {
    vi.mocked(authService.loginAdmin).mockResolvedValue({
      accessToken: "access-tok",
      refreshToken: "refresh-tok",
      user: publicUser,
    })
    const res = await request(app).post("/api/auth/login").send({ email: "a@b.com", password: "secret123" })
    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBe("access-tok")
    expect(res.headers["set-cookie"]?.[0]).toContain("refreshToken=refresh-tok")
  })

  it("returns 400 for a malformed body", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "not-an-email" })
    expect(res.status).toBe(400)
  })

  it("propagates a 401 from the service", async () => {
    const { AppError } = await import("../../middleware/errorHandler")
    vi.mocked(authService.loginAdmin).mockRejectedValue(new AppError(401, "Invalid email or password"))
    const res = await request(app).post("/api/auth/login").send({ email: "a@b.com", password: "wrong" })
    expect(res.status).toBe(401)
  })
})

describe("POST /api/auth/staff-login", () => {
  it("returns 200 with employeeCode in the user payload", async () => {
    vi.mocked(authService.loginStaff).mockResolvedValue({
      accessToken: "access-tok",
      refreshToken: "refresh-tok",
      user: { ...publicUser, role: "EMPLOYEE" as any, employeeCode: "BS-EMP-00001", mustChangePassword: true },
    })
    const res = await request(app)
      .post("/api/auth/staff-login")
      .send({ employeeId: "BS-EMP-00001", password: "temp-pass" })
    expect(res.status).toBe(200)
    expect(res.body.user.employeeCode).toBe("BS-EMP-00001")
    expect(res.body.user.mustChangePassword).toBe(true)
  })

  it("returns 400 for a malformed body", async () => {
    const res = await request(app).post("/api/auth/staff-login").send({ password: "temp-pass" })
    expect(res.status).toBe(400)
  })
})

describe("POST /api/auth/refresh", () => {
  it("reads the refreshToken cookie and returns a new access token", async () => {
    vi.mocked(authService.refresh).mockResolvedValue({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      user: publicUser,
    })
    const res = await request(app).post("/api/auth/refresh").set("Cookie", "refreshToken=old-refresh")
    expect(res.status).toBe(200)
  })

  it("returns 401 when there is no refreshToken cookie", async () => {
    const res = await request(app).post("/api/auth/refresh")
    expect(res.status).toBe(401)
  })
})

describe("POST /api/auth/logout", () => {
  it("clears the cookie and returns success", async () => {
    vi.mocked(authService.logout).mockResolvedValue(undefined)
    const res = await request(app).post("/api/auth/logout").set("Cookie", "refreshToken=some-token")
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

describe("POST /api/auth/forgot-password", () => {
  it("always returns 200 with a generic success message", async () => {
    vi.mocked(authService.requestPasswordReset).mockResolvedValue(undefined)
    const res = await request(app).post("/api/auth/forgot-password").send({ email: "a@b.com" })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

describe("POST /api/auth/reset-password", () => {
  it("returns 200 on success", async () => {
    vi.mocked(authService.resetPassword).mockResolvedValue(undefined)
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "abc", newPassword: "longenoughpw" })
    expect(res.status).toBe(200)
  })

  it("returns 400 for a too-short new password", async () => {
    const res = await request(app).post("/api/auth/reset-password").send({ token: "abc", newPassword: "short" })
    expect(res.status).toBe(400)
  })
})

describe("POST /api/auth/change-password", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await request(app)
      .post("/api/auth/change-password")
      .send({ currentPassword: "old", newPassword: "longenoughpw" })
    expect(res.status).toBe(401)
  })

  it("returns 200 with a valid token and body, and sets a new refreshToken cookie", async () => {
    vi.mocked(authService.changePassword).mockResolvedValue({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      user: { ...publicUser, mustChangePassword: false },
    })
    const token = signAccessToken({ sub: "u1", role: "EMPLOYEE" as any, email: "a@b.com", mustChangePassword: true, salesRole: null })
    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "old", newPassword: "longenoughpw" })
    expect(res.status).toBe(200)
    expect(res.body.user.mustChangePassword).toBe(false)
    expect(res.headers["set-cookie"]?.[0]).toContain("refreshToken=new-refresh")
  })
})
