import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("../../config/prisma", () => ({
  default: {
    payslip: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}))

vi.mock("../attendance/attendance.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../attendance/attendance.service")>()),
  requireEmployeeForUser: vi.fn(),
}))

import app from "../../app"
import prisma from "../../config/prisma"
import { requireEmployeeForUser } from "../attendance/attendance.service"
import { signAccessToken } from "../auth/auth.utils"
import { getEmployeePayslips, getMyPayslips, getPayslip } from "./payroll.service"
import { dec } from "./payroll.money"

type TestRole = "EMPLOYEE" | "REPORTING_MANAGER" | "HR_ADMIN" | "SUPER_ADMIN" | "FINANCE_OFFICER"

const actor = (role: TestRole, sub = "user-1") =>
  ({ sub, role, email: "a@demo.com", mustChangePassword: false }) as never

const auth = (role: TestRole) =>
  `Bearer ${signAccessToken({ sub: "user-1", role: role as never, email: "a@demo.com", mustChangePassword: false, salesRole: null })}`

function payslipRow(over: Record<string, unknown> = {}) {
  return {
    id: "payslip-1",
    payslipNo: "BS-PAY-000001",
    employeeId: "emp-1",
    currency: "BDT",
    grossPay: dec("72258.06"),
    netPay: dec("64758.06"),
    netPayable: dec("65958.06"),
    payrollRun: { id: "run-1", month: 7, year: 2026, status: "APPROVED" },
    employee: { id: "emp-1", fullName: "Ayesha Rahman", employeeCode: "BS-EMP-001" },
    ...over,
  }
}

beforeEach(() => {
  vi.mocked(requireEmployeeForUser).mockResolvedValue({ id: "emp-1" } as never)
  vi.mocked(prisma.payslip.findMany).mockResolvedValue([])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("route auth", () => {
  it("401s /payslips/me with no token", async () => {
    expect((await request(app).get("/api/payroll/payslips/me")).status).toBe(401)
  })

  it("403s /payslips/me for an administrative role with no employee profile", async () => {
    const res = await request(app).get("/api/payroll/payslips/me").set("Authorization", auth("HR_ADMIN"))
    expect(res.status).toBe(403)
  })

  it("200s /payslips/me for staff", async () => {
    const res = await request(app).get("/api/payroll/payslips/me").set("Authorization", auth("EMPLOYEE"))
    expect(res.status).toBe(200)
  })

  it("routes /payslips/me to the self handler, not to :id", async () => {
    // Without the ordering in payroll.routes.ts, Express would match "me" as
    // a payslip id and return 404.
    await request(app).get("/api/payroll/payslips/me").set("Authorization", auth("EMPLOYEE"))
    expect(prisma.payslip.findMany).toHaveBeenCalled()
    expect(prisma.payslip.findUnique).not.toHaveBeenCalled()
  })
})

describe("getMyPayslips", () => {
  it("scopes to the caller's own employee id", async () => {
    await getMyPayslips(actor("EMPLOYEE"))
    expect(prisma.payslip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ employeeId: "emp-1" }) })
    )
  })

  it("hides runs that are not yet approved from staff", async () => {
    await getMyPayslips(actor("EMPLOYEE"))
    const where = vi.mocked(prisma.payslip.findMany).mock.calls[0][0]!.where as Record<string, unknown>
    expect(where.payrollRun).toEqual({ status: { in: ["APPROVED", "DISBURSED"] } })
  })

  it("shows drafts to HR, because working the draft is their job", async () => {
    await getMyPayslips(actor("HR_ADMIN"))
    const where = vi.mocked(prisma.payslip.findMany).mock.calls[0][0]!.where as Record<string, unknown>
    expect(where.payrollRun).toBeUndefined()
  })
})

describe("getEmployeePayslips", () => {
  it("403s an employee reading somebody else", async () => {
    await expect(getEmployeePayslips(actor("EMPLOYEE"), "emp-2")).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it("403s a manager reading a direct report — pay is not a line-manager concern", async () => {
    // The case most likely to be "helpfully" loosened later. The source
    // spec's matrix gives managers no payroll access at all.
    await expect(getEmployeePayslips(actor("REPORTING_MANAGER"), "emp-2")).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it("allows an employee to read themselves", async () => {
    await expect(getEmployeePayslips(actor("EMPLOYEE"), "emp-1")).resolves.toEqual([])
  })

  it.each<TestRole>(["HR_ADMIN", "FINANCE_OFFICER", "SUPER_ADMIN"])(
    "allows %s to read anyone",
    async (role) => {
      await expect(getEmployeePayslips(actor(role), "emp-2")).resolves.toEqual([])
      expect(requireEmployeeForUser).not.toHaveBeenCalled()
    }
  )
})

describe("getPayslip", () => {
  it("404s an unknown id", async () => {
    vi.mocked(prisma.payslip.findUnique).mockResolvedValue(null)
    await expect(getPayslip(actor("HR_ADMIN"), "nope")).rejects.toMatchObject({ statusCode: 404 })
  })

  it("403s an employee reading another employee's payslip", async () => {
    vi.mocked(prisma.payslip.findUnique).mockResolvedValue(payslipRow({ employeeId: "emp-2" }) as never)
    await expect(getPayslip(actor("EMPLOYEE"), "payslip-1")).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it("404s an employee's own payslip while its run is still DRAFT", async () => {
    // 404 rather than 403: they are entitled to it, it just does not exist
    // as far as they are concerned until the run is approved.
    vi.mocked(prisma.payslip.findUnique).mockResolvedValue(
      payslipRow({ payrollRun: { id: "run-1", month: 7, year: 2026, status: "DRAFT" } }) as never
    )
    await expect(getPayslip(actor("EMPLOYEE"), "payslip-1")).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it("returns an employee's own payslip once approved", async () => {
    vi.mocked(prisma.payslip.findUnique).mockResolvedValue(payslipRow() as never)
    await expect(getPayslip(actor("EMPLOYEE"), "payslip-1")).resolves.toMatchObject({
      payslipNo: "BS-PAY-000001",
    })
  })

  it("lets HR read a DRAFT payslip", async () => {
    vi.mocked(prisma.payslip.findUnique).mockResolvedValue(
      payslipRow({ payrollRun: { id: "run-1", month: 7, year: 2026, status: "DRAFT" } }) as never
    )
    await expect(getPayslip(actor("HR_ADMIN"), "payslip-1")).resolves.toBeTruthy()
  })
})

describe("money serialisation", () => {
  it("sends money as JSON strings, never as numbers", async () => {
    // A JSON number is a float again, reintroducing what Decimal exists to
    // avoid. Prisma.Decimal serialises via toJSON as a string.
    vi.mocked(prisma.payslip.findMany).mockResolvedValue([payslipRow()] as never)
    const res = await request(app).get("/api/payroll/payslips/me").set("Authorization", auth("EMPLOYEE"))
    expect(typeof res.body[0].netPayable).toBe("string")
    expect(res.body[0].netPayable).toBe("65958.06")
  })
})
