import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    salaryStructure: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import app from "../../app"
import prisma from "../../config/prisma"
import { signAccessToken } from "../auth/auth.utils"
import { buildSalaryStructureExportSpec } from "./payroll.structure.export"

const db = prisma as any
const token = (role: string) =>
  signAccessToken({ sub: "u1", role: role as any, email: "e@byte.spate", mustChangePassword: false, salesRole: null })

const structure = {
  id: "ss1", name: "Grade 5", currency: "BDT", basic: "50000.00", isActive: true,
  components: [
    { code: "HRENT", label: "House rent", kind: "EARNING", calc: "PERCENT_OF_BASIC", value: "50.00", sortOrder: 0 },
    { code: "TAX", label: "Income tax", kind: "DEDUCTION", calc: "FIXED", value: "3200.00", sortOrder: 1 },
  ],
  _count: { employees: 7 },
}

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async (fn: any) => fn(prisma))
  db.salaryStructure.findMany.mockResolvedValue([structure])
  db.auditLog.create.mockResolvedValue({})
})

describe("buildSalaryStructureExportSpec", () => {
  it("exports one row per structure, with the components in one text cell", async () => {
    const spec = await buildSalaryStructureExportSpec()
    expect(spec.columns.map((c) => c.header)).toEqual(["name", "currency", "basic", "isActive", "employeeCount", "components"])
    expect(spec.rows).toEqual([
      ["Grade 5", "BDT", 50000, true, 7, "House rent: 50 (EARNING, PERCENT_OF_BASIC); Income tax: 3200 (DEDUCTION, FIXED)"],
    ])
  })

  it("writes a structure with no components as an empty cell", async () => {
    db.salaryStructure.findMany.mockResolvedValue([{ ...structure, components: [] }])
    const spec = await buildSalaryStructureExportSpec()
    expect(spec.rows[0][5]).toBe("")
  })
})

describe("GET /api/payroll/salary-structures/export", () => {
  it("serves Finance and Super Admin, and refuses HR and employees", async () => {
    expect((await request(app).get("/api/payroll/salary-structures/export?format=csv")).status).toBe(401)
    for (const role of ["EMPLOYEE", "HR_ADMIN"]) {
      const res = await request(app).get("/api/payroll/salary-structures/export?format=csv").set("Authorization", `Bearer ${token(role)}`)
      expect(res.status).toBe(403)
    }
    for (const role of ["FINANCE_OFFICER", "SUPER_ADMIN"]) {
      const res = await request(app).get("/api/payroll/salary-structures/export?format=csv").set("Authorization", `Bearer ${token(role)}`)
      expect(res.status).toBe(200)
      expect(res.text).toContain("name,currency,basic,isActive,employeeCount,components")
    }
  })

  it("is audited", async () => {
    await request(app).get("/api/payroll/salary-structures/export?format=xlsx").set("Authorization", `Bearer ${token("FINANCE_OFFICER")}`)
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({ entity: "DATA_EXPORT", entityId: "SALARY_STRUCTURES" })
  })
})
