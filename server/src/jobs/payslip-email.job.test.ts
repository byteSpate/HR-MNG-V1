import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../config/prisma", () => ({
  default: {
    payslip: { findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    payrollRun: { findUnique: vi.fn(), update: vi.fn() },
  },
}))
vi.mock("../modules/payroll/payroll.mailer", () => ({ sendPayslipEmail: vi.fn() }))
vi.mock("../modules/payroll/payroll.pdf", () => ({
  getOrRenderPayslipPdf: vi.fn(() => Promise.resolve(Buffer.from("pdf"))),
}))

import prisma from "../config/prisma"
import { sendPayslipEmail } from "../modules/payroll/payroll.mailer"
import { dec } from "../modules/payroll/payroll.money"
import { emailPayslipsForRun, getEmailStatus } from "./payslip-email.job"

const mockedPrisma = prisma as unknown as {
  payslip: {
    findMany: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    count: ReturnType<typeof vi.fn>
  }
  payrollRun: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedPrisma.payrollRun.findUnique.mockResolvedValue({ emailStartedAt: null })
  mockedPrisma.payrollRun.update.mockResolvedValue({})
  mockedPrisma.payslip.update.mockResolvedValue({})
  mockedPrisma.payslip.findMany.mockResolvedValue([])
})

describe("emailPayslipsForRun", () => {
  it("asks only for payslips that have not been emailed", async () => {
    await emailPayslipsForRun("r1")

    expect(mockedPrisma.payslip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { payrollRunId: "r1", emailedAt: null },
      })
    )
  })

  it("asks for every payslip when resend is set", async () => {
    await emailPayslipsForRun("r1", { resend: true })

    expect(mockedPrisma.payslip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { payrollRunId: "r1" } })
    )
  })

  it("refuses to start when a recent run is still claimed", async () => {
    mockedPrisma.payrollRun.findUnique.mockResolvedValue({ emailStartedAt: new Date() })

    const result = await emailPayslipsForRun("r1")

    expect(result).toEqual({ total: 0, sent: 0, failed: 0 })
    expect(mockedPrisma.payslip.findMany).not.toHaveBeenCalled()
  })

  it("reclaims a stale run whose process died", async () => {
    mockedPrisma.payrollRun.findUnique.mockResolvedValue({
      emailStartedAt: new Date(Date.now() - 60 * 60 * 1000),
    })

    await emailPayslipsForRun("r1")

    expect(mockedPrisma.payslip.findMany).toHaveBeenCalled()
  })

  it("clears emailError when a resend succeeds", async () => {
    mockedPrisma.payslip.findMany.mockResolvedValue([
      {
        id: "p1",
        payslipNo: "PS-1",
        currency: "BDT",
        netPayable: dec(1000),
        employee: { fullName: "A", user: { email: "a@b.com" } },
        payrollRun: { month: 1, year: 2026 },
      },
    ])
    vi.mocked(sendPayslipEmail).mockResolvedValue(undefined)

    await emailPayslipsForRun("r1")

    expect(mockedPrisma.payslip.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { emailedAt: expect.any(Date), emailError: null },
    })
  })

  it("releases the claim when the run finishes", async () => {
    await emailPayslipsForRun("r1")

    expect(mockedPrisma.payrollRun.update).toHaveBeenLastCalledWith({
      where: { id: "r1" },
      data: { emailStartedAt: null },
    })
  })
})

describe("getEmailStatus", () => {
  it("counts failed as errored-and-never-sent, so the parts cannot exceed the total", async () => {
    mockedPrisma.payslip.count.mockResolvedValue(0)

    await getEmailStatus("r1")

    expect(mockedPrisma.payslip.count).toHaveBeenCalledWith({
      where: { payrollRunId: "r1", emailError: { not: null }, emailedAt: null },
    })
  })
})
