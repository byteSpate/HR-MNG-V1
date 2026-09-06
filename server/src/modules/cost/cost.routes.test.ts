import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./cost.service", () => ({
  listCosts: vi.fn(async () => [{ id: "cost-1", label: "Rent", status: "PENDING" }]),
  createCost: vi.fn(async () => ({ id: "cost-1" })),
  getCost: vi.fn(async () => ({ id: "cost-1" })),
  updateCost: vi.fn(async () => ({ id: "cost-1" })),
  payCost: vi.fn(async () => ({ id: "cost-1" })),
  listCategories: vi.fn(async () => []),
  createCategory: vi.fn(async () => ({ id: "cat-1" })),
  updateCategory: vi.fn(async () => ({ id: "cat-1" })),
  listCommitments: vi.fn(async () => []),
  createCommitment: vi.fn(async () => ({ id: "cm-1" })),
  updateCommitment: vi.fn(async () => ({ id: "cm-1" })),
  deleteCategory: vi.fn(async () => undefined),
}))

vi.mock("./cost.summary", () => ({
  monthlySummary: vi.fn(async () => ({ categories: [], total: "0.00", paid: "0.00", outstanding: "0.00", overdueCount: 0 })),
}))

vi.mock("./cost.import", () => ({
  previewCostImport: vi.fn(async () => ({ rows: [], issues: [], summary: {} })),
  commitCostImport: vi.fn(async () => ({ costCount: 0, paidCount: 0 })),
}))

vi.mock("./cost.media", () => ({
  uploadReceipt: vi.fn(async () => ({ id: "att-1" })),
  getReceiptUrl: vi.fn(async () => ({ url: "https://signed/url", expiresAt: "2026-01-01T00:00:00.000Z" })),
  deleteReceipt: vi.fn(async () => undefined),
}))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"
import { listCosts } from "./cost.service"

const authHeader = (role: string) => ({
  Authorization: `Bearer ${signAccessToken({
    sub: `user-${role}`,
    role: role as never,
    email: `${role}@demo.com`,
    mustChangePassword: false,
    salesRole: null,
  })}`,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/costs", () => {
  it("lets HR_ADMIN GET the bill list", async () => {
    const res = await request(app).get("/api/costs").set(authHeader("HR_ADMIN"))

    expect(res.status).toBe(200)
    expect(listCosts).toHaveBeenCalled()
  })

  it("403s a REPORTING_MANAGER on GET / — overheads are not their business", async () => {
    const res = await request(app).get("/api/costs").set(authHeader("REPORTING_MANAGER"))

    expect(res.status).toBe(403)
  })

  it("403s an EMPLOYEE on GET /", async () => {
    const res = await request(app).get("/api/costs").set(authHeader("EMPLOYEE"))

    expect(res.status).toBe(403)
  })

  it("401s without a token", async () => {
    const res = await request(app).get("/api/costs")

    expect(res.status).toBe(401)
  })
})

describe("the write matrix", () => {
  it("403s HR_ADMIN on POST /", async () => {
    const res = await request(app)
      .post("/api/costs")
      .set(authHeader("HR_ADMIN"))
      .send({
        categoryId: "11111111-1111-1111-1111-111111111111",
        label: "Rent",
        payee: "Landlord",
        periodMonth: 1,
        periodYear: 2026,
        amount: 1000,
      })

    expect(res.status).toBe(403)
  })

  it("lets FINANCE_OFFICER POST /", async () => {
    const res = await request(app)
      .post("/api/costs")
      .set(authHeader("FINANCE_OFFICER"))
      .send({
        categoryId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        label: "Rent",
        payee: "Landlord",
        periodMonth: 1,
        periodYear: 2026,
        amount: 1000,
      })

    expect(res.status).toBe(201)
  })
})

describe("route ordering", () => {
  it("does not match /summary as a bill id", async () => {
    const res = await request(app)
      .get("/api/costs/summary")
      .query({ year: 2026, month: 1 })
      .set(authHeader("HR_ADMIN"))

    expect(res.status).toBe(200)
    // If /:id were declared first, Express would call getCost with id
    // "summary" and this would return { id: "cost-1" } instead of a summary.
    expect(res.body).toHaveProperty("categories")
  })

  it("does not match /categories as a bill id", async () => {
    const res = await request(app).get("/api/costs/categories").set(authHeader("HR_ADMIN"))

    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

describe("DELETE /api/costs/categories/:id", () => {
  it("refuses an HR admin — cost categories are Finance's", async () => {
    const res = await request(app).delete("/api/costs/categories/c1").set(authHeader("HR_ADMIN"))

    expect(res.status).toBe(403)
  })

  it("allows FINANCE_OFFICER", async () => {
    const res = await request(app)
      .delete("/api/costs/categories/c1")
      .set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(204)
  })
})
