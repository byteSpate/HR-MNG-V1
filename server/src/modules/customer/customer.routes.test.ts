import { describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    customer: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    customerOpeningBalance: { create: vi.fn() },
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

describe("GET /api/customers", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await request(app).get("/api/customers")
    expect(res.status).toBe(401)
  })

  it("returns 200 with the customer list for any authenticated role", async () => {
    vi.mocked(prisma.customer.findMany).mockResolvedValue([
      { id: "c1", legalName: "Acme Corp" },
    ] as any)
    const res = await request(app).get("/api/customers").set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ id: "c1", legalName: "Acme Corp" }])
  })
})

describe("GET /api/customers/:id", () => {
  it("returns 404 when the customer does not exist", async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(null)
    const res = await request(app)
      .get("/api/customers/missing")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(res.status).toBe(404)
  })
})

describe("POST /api/customers", () => {
  it("refuses a non-Finance, non-Admin role with 403", async () => {
    const res = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
      .send({ legalName: "Acme Corp" })
    expect(res.status).toBe(403)
  })

  it("accepts Finance Officer and creates the record", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
    vi.mocked(prisma.customer.create).mockResolvedValue({ id: "c1", legalName: "Acme Corp" } as any)
    const res = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
      .send({ legalName: "Acme Corp" })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: "c1", legalName: "Acme Corp" })
  })

  it("returns 400 for a body that fails validation", async () => {
    const res = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
      .send({ legalName: "" })
    expect(res.status).toBe(400)
  })
})

describe("PATCH /api/customers/:id", () => {
  it("refuses a non-Finance, non-Admin role with 403", async () => {
    const res = await request(app)
      .patch("/api/customers/c1")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
      .send({ legalName: "New Name" })
    expect(res.status).toBe(403)
  })
})

describe("POST /api/customers/opening-balances/preview", () => {
  it("refuses a non-Finance, non-Admin role with 403", async () => {
    const res = await request(app)
      .post("/api/customers/opening-balances/preview")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
      .attach("file", Buffer.from("legalName,amount\nAcme,1000\n"), "test.csv")
    expect(res.status).toBe(403)
  })

  it("returns a preview for Finance Officer", async () => {
    vi.mocked(prisma.customer.findMany).mockResolvedValue([])
    const res = await request(app)
      .post("/api/customers/opening-balances/preview")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
      .attach("file", Buffer.from("legalName,amount\nAcme,1000\n"), "test.csv")
    expect(res.status).toBe(200)
    expect(res.body.rows).toEqual([expect.objectContaining({ legalName: "Acme", amount: 1000 })])
  })
})

describe("POST /api/customers/opening-balances/commit", () => {
  it("refuses Finance Officer with 403 — commit is Super Admin only", async () => {
    const res = await request(app)
      .post("/api/customers/opening-balances/commit")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
      .attach("file", Buffer.from("legalName,amount\nAcme,1000\n"), "test.csv")
    expect(res.status).toBe(403)
  })

  it("accepts Super Admin and commits the import", async () => {
    vi.mocked(prisma.customer.findMany).mockResolvedValue([])
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.customer.create).mockResolvedValue({ id: "c1", legalName: "Acme" } as any)
    const res = await request(app)
      .post("/api/customers/opening-balances/commit")
      .set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)
      .attach("file", Buffer.from("legalName,amount\nAcme,1000\n"), "test.csv")
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ customerCount: 1, totalAmount: 1000 })
  })
})
