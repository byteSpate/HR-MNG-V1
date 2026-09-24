import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    vatCode: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"

function tokenFor(role: "EMPLOYEE" | "FINANCE_OFFICER" | "SUPER_ADMIN") {
  return signAccessToken({ sub: "u1", role: role as any, email: "e@byte.spate", mustChangePassword: false, salesRole: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.vatCode.findMany).mockResolvedValue([])
})

describe("GET /api/vat-codes", () => {
  it("refuses with no token", async () => {
    const res = await request(app).get("/api/vat-codes")
    expect(res.status).toBe(401)
  })

  it("returns the list to any authenticated role", async () => {
    const res = await request(app).get("/api/vat-codes").set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(res.status).toBe(200)
  })

  it("passes all=true through to the service", async () => {
    await request(app).get("/api/vat-codes?all=true").set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(vi.mocked(prisma.vatCode.findMany).mock.calls[0][0]).not.toHaveProperty("where.isActive")
  })
})

describe("POST /api/vat-codes", () => {
  it("refuses an employee with 403", async () => {
    const res = await request(app).post("/api/vat-codes").send({}).set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(res.status).toBe(403)
  })

  it("lets Finance create a code", async () => {
    vi.mocked(prisma.vatCode.create).mockResolvedValue({ id: "v2", code: "ZERO0", name: "Zero rated", ratePercent: "0" } as any)
    const res = await request(app)
      .post("/api/vat-codes")
      .send({ code: "ZERO0", name: "Zero rated", ratePercent: "0" })
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(201)
  })

  it("400s a bad rate", async () => {
    const res = await request(app)
      .post("/api/vat-codes")
      .send({ code: "BAD", name: "Bad", ratePercent: "not-a-number" })
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(400)
  })
})

describe("PATCH /api/vat-codes/:id", () => {
  it("refuses an employee with 403", async () => {
    const res = await request(app).patch("/api/vat-codes/v1").send({}).set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(res.status).toBe(403)
  })

  it("lets Finance change the rate", async () => {
    vi.mocked(prisma.vatCode.findUnique).mockResolvedValue({ id: "v1", code: "STD15", name: "Standard 15%", ratePercent: "15", isActive: true } as any)
    vi.mocked(prisma.vatCode.update).mockResolvedValue({ id: "v1", code: "STD15", name: "Standard 15%", ratePercent: "7.5", isActive: true } as any)
    const res = await request(app)
      .patch("/api/vat-codes/v1")
      .send({ ratePercent: "7.5" })
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(200)
  })
})
