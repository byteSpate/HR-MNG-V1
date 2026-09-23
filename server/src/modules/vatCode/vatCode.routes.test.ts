import { describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("../../config/prisma", () => ({
  default: { vatCode: { findMany: vi.fn().mockResolvedValue([]) } },
}))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"

describe("GET /api/vat-codes", () => {
  it("refuses with no token", async () => {
    const res = await request(app).get("/api/vat-codes")
    expect(res.status).toBe(401)
  })

  it("returns the list to any authenticated role", async () => {
    const token = signAccessToken({
      sub: "u1", role: "EMPLOYEE", email: "e@byte.spate", mustChangePassword: false, salesRole: null,
    })
    const res = await request(app).get("/api/vat-codes").set("Authorization", `Bearer ${token}`)
    expect(res.status).toBe(200)
  })
})
