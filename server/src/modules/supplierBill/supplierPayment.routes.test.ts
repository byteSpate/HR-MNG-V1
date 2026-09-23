import { describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    supplierPayment: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    supplierPaymentAllocation: { create: vi.fn() },
    supplierBill: { findUniqueOrThrow: vi.fn() },
    auditLog: { create: vi.fn() },
    journal: { create: vi.fn() },
  },
}))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"

function tokenFor(role: "EMPLOYEE" | "FINANCE_OFFICER" | "SUPER_ADMIN") {
  return signAccessToken({ sub: "actor-1", role: role as any, email: "a@b.com", mustChangePassword: false, salesRole: null })
}

describe("GET /api/supplier-payments", () => {
  it("refuses with no token", async () => {
    const res = await request(app).get("/api/supplier-payments")
    expect(res.status).toBe(401)
  })
})

describe("POST /api/supplier-payments", () => {
  it("refuses a non-Finance, non-Admin role with 403", async () => {
    const res = await request(app)
      .post("/api/supplier-payments")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
      .send({})
    expect(res.status).toBe(403)
  })
})

describe("POST /api/supplier-payments/:id/approve", () => {
  it("refuses Finance Officer with 403 — approve is Super Admin only", async () => {
    const res = await request(app)
      .post("/api/supplier-payments/p1/approve")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(403)
  })
})

describe("POST /api/supplier-payments/:id/match-advance", () => {
  it("refuses a non-Finance, non-Admin role with 403", async () => {
    const res = await request(app)
      .post("/api/supplier-payments/p1/match-advance")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
      .send({ billId: "b1", amount: "1000" })
    expect(res.status).toBe(403)
  })
})
