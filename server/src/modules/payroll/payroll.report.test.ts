import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    employee: { findUnique: vi.fn().mockResolvedValue(null) },
    payslip: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import app from "../../app"
import prisma from "../../config/prisma"
import { signAccessToken } from "../auth/auth.utils"
import { runPeriodWhere } from "./payroll.report"

const db = prisma as any
const token = (role: string) =>
  signAccessToken({ sub: "u1", role: role as any, email: "e@byte.spate", mustChangePassword: false, salesRole: null })

const slip = (over: Record<string, unknown>) => ({
  payslipNo: "PS-2026-02-0001",
  currency: "BDT",
  payableDays: "28.00",
  lopDays: "0.00",
  grossPay: "50000.00",
  totalDeductions: "2000.00",
  netPay: "48000.00",
  reimbursements: "500.00",
  netPayable: "48500.00",
  netPayableBdt: "48500.00",
  payrollRun: { month: 2, year: 2026, status: "DISBURSED" },
  employee: { employeeCode: "E-1", fullName: "Rahim", department: { name: "Tech" } },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async (fn: any) => fn(prisma))
  db.auditLog.create.mockResolvedValue({})
  db.payslip.findMany.mockResolvedValue([
    slip({}),
    slip({
      payslipNo: "PS-2026-02-0002", currency: "USD", grossPay: "1000.00", totalDeductions: "0.00",
      netPay: "1000.00", reimbursements: "0.00", netPayable: "1000.00", netPayableBdt: "120000.00",
      employee: { employeeCode: "E-2", fullName: "Sara", department: { name: "Sales" } },
    }),
  ])
})

describe("runPeriodWhere", () => {
  it("covers a range inside one year", () => {
    expect(runPeriodWhere({ year: 2026, month: 1 }, { year: 2026, month: 3 })).toEqual({
      year: 2026, month: { gte: 1, lte: 3 },
    })
  })

  it("covers a range across years", () => {
    expect(runPeriodWhere({ year: 2025, month: 11 }, { year: 2026, month: 2 })).toEqual({
      OR: [
        { year: 2025, month: { gte: 11 } },
        { year: { gt: 2025, lt: 2026 } },
        { year: 2026, month: { lte: 2 } },
      ],
    })
  })
})

describe("GET /api/payroll/report", () => {
  it("shows claims paid back on screen and in the PDF, so net payable adds up", async () => {
    const res = await request(app)
      .get("/api/payroll/report?from=2026-02&to=2026-02")
      .set("Authorization", `Bearer ${token("FINANCE_OFFICER")}`)
    const claims = res.body.columns.find((c: { header: string }) => c.header === "reimbursements")
    expect(claims).toMatchObject({ pdfHeader: "Claims paid back", inPdf: true })
  })

  it("is for Finance, HR Admin and Super Admin", async () => {
    for (const role of ["EMPLOYEE", "REPORTING_MANAGER"]) {
      const res = await request(app)
        .get("/api/payroll/report?from=2026-02&to=2026-02")
        .set("Authorization", `Bearer ${token(role)}`)
      expect(res.status).toBe(403)
    }
    for (const role of ["FINANCE_OFFICER", "HR_ADMIN", "SUPER_ADMIN"]) {
      const res = await request(app)
        .get("/api/payroll/report?from=2026-02&to=2026-02")
        .set("Authorization", `Bearer ${token(role)}`)
      expect(res.status).toBe(200)
    }
  })

  it("lists payslips of runs that are not deleted, with totals kept apart by currency", async () => {
    const res = await request(app)
      .get("/api/payroll/report?from=2026-02&to=2026-02")
      .set("Authorization", `Bearer ${token("FINANCE_OFFICER")}`)
    expect(db.payslip.findMany.mock.calls[0][0].where).toEqual({
      payrollRun: { deletedAt: null, year: 2026, month: { gte: 2, lte: 2 } },
    })
    expect(res.body.filterNote).toBe("February 2026")
    expect(res.body.rows[0]).toEqual([
      "February 2026", "PS-2026-02-0001", "E-1", "Rahim", "Tech", "BDT",
      28, 0, 50000, 2000, 48000, 500, 48500, 48500, "Paid",
    ])
    expect(res.body.summary).toEqual([
      { label: "Payslips", value: "2" },
      { label: "Net payable BDT", value: "48,500.00" },
      { label: "Net payable USD", value: "1,000.00" },
      { label: "All in BDT", value: "168,500.00" },
    ])
  })

  it("filters by run status and names it in the note", async () => {
    const res = await request(app)
      .get("/api/payroll/report?from=2025-11&to=2026-02&status=APPROVED")
      .set("Authorization", `Bearer ${token("HR_ADMIN")}`)
    expect(db.payslip.findMany.mock.calls[0][0].where.payrollRun).toMatchObject({ deletedAt: null, status: "APPROVED" })
    expect(res.body.filterNote).toBe("November 2025 to February 2026 · Approved, not paid yet")
  })

  it("refuses a bad month in plain words", async () => {
    const res = await request(app)
      .get("/api/payroll/report?from=2026-13&to=2026-02")
      .set("Authorization", `Bearer ${token("HR_ADMIN")}`)
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("Pick a real month for From and To.")
  })

  it("downloads an Excel file and writes an audit row", async () => {
    const res = await request(app)
      .get("/api/payroll/report?from=2026-02&to=2026-02&format=xlsx")
      .set("Authorization", `Bearer ${token("FINANCE_OFFICER")}`)
    expect(res.status).toBe(200)
    expect(res.headers["content-disposition"]).toMatch(/payroll-report-/)
    expect(db.auditLog.create).toHaveBeenCalledTimes(1)
  })
})
