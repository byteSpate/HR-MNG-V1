import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    customer: { findMany: vi.fn(), findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import app from "../../app"
import prisma from "../../config/prisma"
import { signAccessToken } from "../auth/auth.utils"
import { buildCustomerExportSpec } from "./customer.export"

const db = prisma as any
const token = (role: string) =>
  signAccessToken({ sub: "u1", role: role as any, email: "e@byte.spate", mustChangePassword: false, salesRole: null })

const rows = [
  { id: "c1", legalName: "Bengal Group", billingAddress: "Dhaka", bin: "111", paymentDays: 30, salesAccountId: "sa1", createdAt: new Date("2026-09-01T00:00:00.000Z") },
  { id: "c2", legalName: "Old Client", billingAddress: null, bin: null, paymentDays: 45, salesAccountId: null, createdAt: new Date("2026-09-02T00:00:00.000Z") },
]

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async (fn: any) => fn(prisma))
  db.customer.findMany.mockResolvedValue(rows)
  db.customer.findUnique.mockResolvedValue(null)
  db.auditLog.create.mockResolvedValue({})
})

describe("buildCustomerExportSpec", () => {
  it("exports each customer and says whether it came from a Sales Account", async () => {
    const spec = await buildCustomerExportSpec()
    expect(spec.columns.map((c) => c.header)).toEqual([
      "legalName", "billingAddress", "bin", "paymentDays", "linkedToSalesAccount", "createdAt",
    ])
    expect(spec.rows[0]).toEqual(["Bengal Group", "Dhaka", "111", 30, true, new Date("2026-09-01T00:00:00.000Z")])
    expect(spec.rows[1][4]).toBe(false)
  })
})

describe("GET /api/customers/export", () => {
  it("serves Finance and Super Admin, and refuses HR, employees and no token", async () => {
    expect((await request(app).get("/api/customers/export?format=csv")).status).toBe(401)
    for (const role of ["EMPLOYEE", "HR_ADMIN"]) {
      const res = await request(app).get("/api/customers/export?format=csv").set("Authorization", `Bearer ${token(role)}`)
      expect(res.status).toBe(403)
    }
    for (const role of ["FINANCE_OFFICER", "SUPER_ADMIN"]) {
      const res = await request(app).get("/api/customers/export?format=csv").set("Authorization", `Bearer ${token(role)}`)
      expect(res.status).toBe(200)
      expect(res.text).toContain("legalName,billingAddress,bin")
    }
  })

  it("is not swallowed by the /:id route, and writes an audit row", async () => {
    const res = await request(app).get("/api/customers/export?format=xlsx").set("Authorization", `Bearer ${token("FINANCE_OFFICER")}`)
    expect(res.status).toBe(200)
    expect(db.customer.findUnique).not.toHaveBeenCalled()
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({ entity: "DATA_EXPORT", entityId: "CUSTOMERS" })
  })

  it("has no import route", async () => {
    const res = await request(app).get("/api/customers/import/template").set("Authorization", `Bearer ${token("FINANCE_OFFICER")}`)
    expect(res.status).not.toBe(200)
  })
})
