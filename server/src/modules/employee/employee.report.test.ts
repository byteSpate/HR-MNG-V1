import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    employee: { findMany: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) },
    department: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import app from "../../app"
import prisma from "../../config/prisma"
import { signAccessToken } from "../auth/auth.utils"

const db = prisma as any
const token = (role: string) =>
  signAccessToken({ sub: "u1", role: role as any, email: "e@byte.spate", mustChangePassword: false, salesRole: null })

const row = (code: string, status: string) => ({
  employeeCode: code, fullName: `Person ${code}`, designation: "Engineer",
  employmentType: "FULL_TIME", employmentStatus: status, joiningDate: new Date("2024-03-01T00:00:00.000Z"),
  phone: null, nationalId: null, dateOfBirth: null, presentAddress: null,
  bankName: null, bankAccountNumber: null, bankRoutingNumber: null,
  department: { name: "Tech" }, reportingManager: null, shift: null, user: { email: `${code}@byte.spate` },
})

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async (fn: any) => fn(prisma))
  db.employee.findMany.mockResolvedValue([row("E-1", "ACTIVE"), row("E-2", "ACTIVE"), row("E-3", "RESIGNED")])
  db.department.findUnique.mockResolvedValue({ name: "Tech" })
  db.auditLog.create.mockResolvedValue({})
})

describe("GET /api/employees/report", () => {
  it("is for HR Admin and Super Admin only", async () => {
    for (const role of ["EMPLOYEE", "REPORTING_MANAGER", "FINANCE_OFFICER"]) {
      const res = await request(app).get("/api/employees/report").set("Authorization", `Bearer ${token(role)}`)
      expect(res.status).toBe(403)
    }
  })

  it("returns every employee with a count per status", async () => {
    const res = await request(app).get("/api/employees/report").set("Authorization", `Bearer ${token("HR_ADMIN")}`)
    expect(res.status).toBe(200)
    expect(db.employee.findMany.mock.calls[0][0].where).toEqual({})
    expect(res.body.rows).toHaveLength(3)
    expect(res.body.filterNote).toBe("Everyone")
    expect(res.body.summary).toEqual([
      { label: "Employees", value: "3" },
      { label: "Active", value: "2" },
      { label: "Resigned", value: "1" },
    ])
  })

  it("shows status and type as plain words, not as codes", async () => {
    const res = await request(app).get("/api/employees/report").set("Authorization", `Bearer ${token("HR_ADMIN")}`)
    const at = (h: string) => res.body.columns.findIndex((c: { header: string }) => c.header === h)
    expect(res.body.rows.map((r: unknown[]) => r[at("employmentStatus")])).toEqual(["Active", "Active", "Resigned"])
    expect(res.body.rows[0][at("employmentType")]).toBe("Full time")
  })

  it("filters by status and department, and says so in the note", async () => {
    const res = await request(app)
      .get("/api/employees/report?status=ACTIVE&departmentId=d1")
      .set("Authorization", `Bearer ${token("SUPER_ADMIN")}`)
    expect(res.status).toBe(200)
    expect(db.employee.findMany.mock.calls[0][0].where).toEqual({ employmentStatus: "ACTIVE", departmentId: "d1" })
    expect(res.body.filterNote).toBe("Status: Active · Department: Tech")
  })

  it("refuses a status that does not exist", async () => {
    const res = await request(app)
      .get("/api/employees/report?status=SLEEPING")
      .set("Authorization", `Bearer ${token("HR_ADMIN")}`)
    expect(res.status).toBe(400)
  })

  it("downloads a file and writes an audit row", async () => {
    const res = await request(app)
      .get("/api/employees/report?format=csv&status=RESIGNED")
      .set("Authorization", `Bearer ${token("HR_ADMIN")}`)
    expect(res.status).toBe(200)
    expect(res.headers["content-type"]).toContain("text/csv")
    expect(res.headers["content-disposition"]).toMatch(/employee-report-/)
    expect(db.auditLog.create).toHaveBeenCalledTimes(1)
  })
})
