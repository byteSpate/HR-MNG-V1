import { describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    supplier: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    supplierOpeningBalance: { create: vi.fn() },
    journalLine: { count: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import app from "../../app"
import prisma from "../../config/prisma"
import { signAccessToken } from "../auth/auth.utils"

function tokenFor(role: "EMPLOYEE" | "FINANCE_OFFICER" | "SUPER_ADMIN") {
  return signAccessToken({
    sub: "actor-1", role: role as any, email: "actor@b.com", mustChangePassword: false, salesRole: null,
  })
}

describe("GET /api/suppliers", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await request(app).get("/api/suppliers")
    expect(res.status).toBe(401)
  })

  it("returns 200 with the supplier list for any authenticated role", async () => {
    vi.mocked(prisma.supplier.findMany).mockResolvedValue([{ id: "s1", name: "Star Tech" }] as any)
    const res = await request(app).get("/api/suppliers").set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ id: "s1", name: "Star Tech" }])
  })
})

describe("POST /api/suppliers", () => {
  it("refuses a non-Finance, non-Admin role with 403", async () => {
    const res = await request(app)
      .post("/api/suppliers")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
      .send({ name: "Star Tech" })
    expect(res.status).toBe(403)
  })

  it("accepts Finance Officer and creates the record", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
    vi.mocked(prisma.supplier.create).mockResolvedValue({ id: "s1", name: "Star Tech" } as any)
    const res = await request(app)
      .post("/api/suppliers")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
      .send({ name: "Star Tech" })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: "s1", name: "Star Tech" })
  })
})

describe("POST /api/suppliers/:id/deactivate", () => {
  it("refuses a non-Finance, non-Admin role with 403", async () => {
    const res = await request(app)
      .post("/api/suppliers/s1/deactivate")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(res.status).toBe(403)
  })

  it("accepts Finance Officer and deactivates the record", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
    vi.mocked(prisma.supplier.findUnique).mockResolvedValue({ id: "s1", name: "Star Tech" } as any)
    vi.mocked(prisma.supplier.update).mockResolvedValue({ id: "s1", isActive: false } as any)
    const res = await request(app)
      .post("/api/suppliers/s1/deactivate")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: "s1", isActive: false })
  })
})

describe("POST /api/suppliers/:id/reactivate", () => {
  it("refuses a non-Finance, non-Admin role with 403", async () => {
    const res = await request(app)
      .post("/api/suppliers/s1/reactivate")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(res.status).toBe(403)
  })

  it("accepts Finance Officer and reactivates the record", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
    vi.mocked(prisma.supplier.findUnique).mockResolvedValue({ id: "s1", name: "Star Tech" } as any)
    vi.mocked(prisma.supplier.update).mockResolvedValue({ id: "s1", isActive: true } as any)
    const res = await request(app)
      .post("/api/suppliers/s1/reactivate")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: "s1", isActive: true })
  })
})

describe("POST /api/suppliers/opening-balances/preview", () => {
  it("refuses a non-Finance, non-Admin role with 403", async () => {
    const res = await request(app)
      .post("/api/suppliers/opening-balances/preview")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
      .attach("file", Buffer.from("name,amount\nStar Tech,1000\n"), "test.csv")
    expect(res.status).toBe(403)
  })

  it("returns a preview for Finance Officer", async () => {
    vi.mocked(prisma.supplier.findMany).mockResolvedValue([])
    const res = await request(app)
      .post("/api/suppliers/opening-balances/preview")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
      .attach("file", Buffer.from("name,amount\nStar Tech,1000\n"), "test.csv")
    expect(res.status).toBe(200)
    expect(res.body.rows).toEqual([expect.objectContaining({ name: "Star Tech", amount: 1000 })])
  })
})

describe("POST /api/suppliers/opening-balances/commit", () => {
  it("refuses Finance Officer with 403 — commit is Super Admin only", async () => {
    const res = await request(app)
      .post("/api/suppliers/opening-balances/commit")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
      .attach("file", Buffer.from("name,amount\nStar Tech,1000\n"), "test.csv")
    expect(res.status).toBe(403)
  })

  it("accepts Super Admin and commits the import", async () => {
    vi.mocked(prisma.supplier.findMany).mockResolvedValue([])
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
    vi.mocked(prisma.supplier.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.supplier.create).mockResolvedValue({ id: "s1", name: "Star Tech" } as any)
    const res = await request(app)
      .post("/api/suppliers/opening-balances/commit")
      .set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)
      .attach("file", Buffer.from("name,amount\nStar Tech,1000\n"), "test.csv")
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ supplierCount: 1, totalAmount: 1000 })
  })
})
