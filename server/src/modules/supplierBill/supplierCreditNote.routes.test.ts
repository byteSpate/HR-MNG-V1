import { describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    supplierBill: { findUnique: vi.fn() },
    supplierCreditNote: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"

function tokenFor(role: "EMPLOYEE" | "FINANCE_OFFICER" | "SUPER_ADMIN") {
  return signAccessToken({ sub: "actor-1", role: role as any, email: "a@b.com", mustChangePassword: false, salesRole: null })
}

describe("GET /api/supplier-credit-notes", () => {
  it("refuses with no token", async () => {
    const res = await request(app).get("/api/supplier-credit-notes")
    expect(res.status).toBe(401)
  })
})

describe("GET /api/supplier-credit-notes (read gate)", () => {
  it("refuses an employee with 403: supplier credit notes are Finance and Admin only", async () => {
    const res = await request(app).get("/api/supplier-credit-notes").set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(res.status).toBe(403)
  })
  it("refuses an employee reading one credit note with 403", async () => {
    const res = await request(app).get("/api/supplier-credit-notes/cn1").set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(res.status).toBe(403)
  })
})

describe("POST /api/supplier-credit-notes", () => {
  it("refuses a non-Finance, non-Admin role with 403", async () => {
    const res = await request(app)
      .post("/api/supplier-credit-notes")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
      .send({})
    expect(res.status).toBe(403)
  })
})

describe("POST /api/supplier-credit-notes/:id/approve", () => {
  it("refuses Finance Officer with 403, approve is Super Admin only", async () => {
    const res = await request(app)
      .post("/api/supplier-credit-notes/cn1/approve")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(403)
  })
})
