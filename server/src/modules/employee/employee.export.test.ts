import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    employee: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import app from "../../app"
import prisma from "../../config/prisma"
import { signAccessToken } from "../auth/auth.utils"
import { buildEmployeeExportSpec } from "./employee.export"

const db = prisma as any
const token = (role: string) =>
  signAccessToken({ sub: "u1", role: role as any, email: "e@byte.spate", mustChangePassword: false, salesRole: null })

const employee = {
  employeeCode: "E-001", fullName: "Rahim Uddin", designation: "Accountant",
  employmentType: "FULL_TIME", employmentStatus: "ACTIVE", joiningDate: new Date("2024-03-01T00:00:00.000Z"),
  phone: "+8801711000000", nationalId: "1990123456789", dateOfBirth: new Date("1990-05-10T00:00:00.000Z"),
  presentAddress: "House 1, Dhaka", bankName: "City Bank", bankAccountNumber: "000111", bankRoutingNumber: "090",
  department: { name: "Finance" }, reportingManager: { fullName: "Karim Hossain" }, shift: { name: "General" },
  user: { email: "rahim@byte.spate" },
}
const noManager = { ...employee, employeeCode: "E-002", fullName: "Boss", reportingManager: null, shift: null, nationalId: null }

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async (fn: any) => fn(prisma))
  db.employee.findMany.mockResolvedValue([employee, noManager])
  db.employee.findUnique.mockResolvedValue(null)
  db.auditLog.create.mockResolvedValue({})
})

describe("buildEmployeeExportSpec", () => {
  it("lists public columns first, then the private ones", async () => {
    const spec = await buildEmployeeExportSpec()
    expect(spec.columns.map((c) => c.header)).toEqual([
      "employeeCode", "fullName", "designation", "department", "reportingManager", "employmentType",
      "employmentStatus", "joiningDate", "shift", "phone", "email",
      "nationalId", "dateOfBirth", "presentAddress", "bankName", "bankAccountNumber", "bankRoutingNumber",
    ])
  })

  it("keeps every private column out of the PDF", async () => {
    const spec = await buildEmployeeExportSpec()
    const inPdf = spec.columns.filter((c) => c.inPdf).map((c) => c.header)
    for (const header of ["nationalId", "dateOfBirth", "presentAddress", "bankName", "bankAccountNumber", "bankRoutingNumber"]) {
      expect(inPdf).not.toContain(header)
    }
    expect(inPdf).toContain("fullName")
  })

  it("writes department, manager, shift and email as text, and blank for a missing one", async () => {
    const spec = await buildEmployeeExportSpec()
    expect(spec.rows[0].slice(0, 5)).toEqual(["E-001", "Rahim Uddin", "Accountant", "Finance", "Karim Hossain"])
    expect(spec.rows[0][10]).toBe("rahim@byte.spate")
    expect(spec.rows[1][4]).toBeNull()
    expect(spec.rows[1][8]).toBeNull()
    expect(spec.rows[1][11]).toBeNull()
  })
})

describe("GET /api/employees/export", () => {
  it("serves HR and Super Admin, and refuses everyone else", async () => {
    expect((await request(app).get("/api/employees/export?format=csv")).status).toBe(401)
    for (const role of ["EMPLOYEE", "REPORTING_MANAGER", "FINANCE_OFFICER"]) {
      const res = await request(app).get("/api/employees/export?format=csv").set("Authorization", `Bearer ${token(role)}`)
      expect(res.status).toBe(403)
    }
    for (const role of ["HR_ADMIN", "SUPER_ADMIN"]) {
      const res = await request(app).get("/api/employees/export?format=csv").set("Authorization", `Bearer ${token(role)}`)
      expect(res.status).toBe(200)
      expect(res.text).toContain("nationalId")
    }
  })

  it("is not swallowed by the /:id route, and is audited", async () => {
    const res = await request(app).get("/api/employees/export?format=xlsx").set("Authorization", `Bearer ${token("HR_ADMIN")}`)
    expect(res.status).toBe(200)
    expect(db.employee.findUnique).not.toHaveBeenCalled()
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({
      entity: "DATA_EXPORT", entityId: "EMPLOYEES", action: "EXPORT", changedBy: "u1",
      after: { format: "xlsx", rows: 2 },
    })
  })
})
