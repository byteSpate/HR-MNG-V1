import { describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./modules/auth/auth.service", () => ({
  loginAdmin: vi.fn().mockRejectedValue(new Error("bad")),
  loginStaff: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  changePassword: vi.fn(),
}))

import app, { JSON_BODY_LIMIT_BYTES } from "./app"

describe("the JSON body limit", () => {
  it("the limit is 256 KB, about six times the biggest real body (an announcement of 10,000 characters)", () => {
    expect(JSON_BODY_LIMIT_BYTES).toBe(256 * 1024)
  })

  it("a JSON body over the limit gets 413 with an easy English sentence, not a 500", async () => {
    const big = JSON.stringify({ email: "a@b.com", password: "x".repeat(JSON_BODY_LIMIT_BYTES + 1024) })
    const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send(big)
    expect(res.status).toBe(413)
    expect(res.body.error).toBe("This request is too big. Send less data and try again.")
  })

  it("a normal body still reaches the route (any answer except 413)", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "a@b.com", password: "secret123" })
    expect(res.status).not.toBe(413)
  })
})
