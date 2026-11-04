import { describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./auth.service", () => ({
  loginAdmin: vi.fn().mockRejectedValue(new Error("bad")),
  loginStaff: vi.fn().mockRejectedValue(new Error("bad")),
  refresh: vi.fn(),
  logout: vi.fn(),
  requestPasswordReset: vi.fn().mockResolvedValue(undefined),
  resetPassword: vi.fn(),
  changePassword: vi.fn(),
}))

import app from "../../app"

async function hammer(path: string, times: number) {
  let last = await request(app).post(path).send({})
  for (let i = 1; i < times; i++) last = await request(app).post(path).send({})
  return last
}

describe("sign-in rate limit", () => {
  it("refuses the 11th try on /api/auth/login with 429", async () => {
    const res = await hammer("/api/auth/login", 11)
    expect(res.status).toBe(429)
    expect(res.body.error).toMatch(/Too many tries/)
  })

  it("refuses the 11th try on /api/auth/staff-login with 429", async () => {
    const res = await hammer("/api/auth/staff-login", 11)
    expect(res.status).toBe(429)
  })

  it("refuses the 11th try on /api/auth/forgot-password with 429", async () => {
    const res = await hammer("/api/auth/forgot-password", 11)
    expect(res.status).toBe(429)
  })

  it("counts each route on its own (a full /login does not block /refresh)", async () => {
    const res = await request(app).post("/api/auth/refresh")
    expect(res.status).not.toBe(429)
  })
})
