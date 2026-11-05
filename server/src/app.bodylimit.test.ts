import { describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./modules/auth/auth.service", () => ({
  loginAdmin: vi.fn(),
  loginStaff: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  changePassword: vi.fn(),
}))

import app, { JSON_BODY_LIMIT_BYTES } from "./app"
import { AppError } from "./middleware/errorHandler"
import * as authService from "./modules/auth/auth.service"

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

  it("a normal body still reaches the route (the mocked sign-in answers 401)", async () => {
    vi.mocked(authService.loginAdmin).mockRejectedValueOnce(new AppError(401, "Invalid email or password"))
    const res = await request(app).post("/api/auth/login").send({ email: "a@b.com", password: "secret123" })
    expect(res.status).toBe(401)
  })

  it("broken JSON is a 400 with an easy English sentence, not a 500", async () => {
    const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send('{"email": "a@b.com",')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("We could not read this request. Check it and try again.")
  })

  it("a file upload bigger than the JSON limit is not refused by it (uploads do not use express.json)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .attach("file", Buffer.alloc(JSON_BODY_LIMIT_BYTES + 50_000, "a"), "big.bin")
    expect(res.status).not.toBe(413)
  })
})
