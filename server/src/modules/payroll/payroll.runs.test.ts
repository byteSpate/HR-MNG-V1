import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => {
  const tx = {
    payrollRun: { create: vi.fn(), update: vi.fn() },
    // `findMany` because approving a run emits one payslip.published per
    // employee, read from inside the same transaction.
    payslip: { deleteMany: vi.fn(), create: vi.fn(), findMany: vi.fn(async () => []) },
    payrollAdjustment: { findMany: vi.fn(), updateMany: vi.fn() },
    expenseClaim: { findMany: vi.fn(), updateMany: vi.fn() },
    assetRecovery: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
    idCounter: { upsert: vi.fn() },
    auditLog: { create: vi.fn() },
    // The event log, written in the same transaction. Distinct from
    // auditLog: one row per user action rather than per record.
    event: { create: vi.fn() },
    employee: { findUnique: vi.fn() },
  }
  return {
    default: {
      payrollRun: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
      // `aggregate` because submitting a run emails every Super Admin the
      // headcount and the BDT total, read after the transaction commits.
      payslip: {
        groupBy: vi.fn(),
        findMany: vi.fn(),
        aggregate: vi.fn(async () => ({ _sum: { netPayableBdt: null }, _count: { _all: 0 } })),
      },
      employee: { findMany: vi.fn(), count: vi.fn() },
      exchangeRate: { findMany: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  }
})

vi.mock("../attendance/attendance.summary", () => ({
  getMonthlySummary: vi.fn(),
}))

vi.mock("./payroll.posting", () => ({
  postPayrollAccrual: vi.fn(),
  postPayrollPayment: vi.fn(),
}))

vi.mock("../notification/notification.mailer", () => ({
  sendPayrollSubmittedEmail: vi.fn(() => Promise.resolve()),
}))
vi.mock("../notification/notification.recipients", () => ({
  activeSuperAdminEmails: vi.fn(() => Promise.resolve([])),
}))

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { sendPayrollSubmittedEmail } from "../notification/notification.mailer"
import { activeSuperAdminEmails } from "../notification/notification.recipients"
import { postPayrollAccrual, postPayrollPayment } from "./payroll.posting"
import { getMonthlySummary } from "../attendance/attendance.summary"
import type { MonthlyAttendanceSummary } from "../attendance/attendance.types"
import {
  approveRun,
  createRun,
  disburseRun,
  processRun,
  rejectRun,
  submitRun,
} from "./payroll.service"
import { dec } from "./payroll.money"

const tx = (prisma as unknown as { __tx: any }).__tx

// July 2026 (31 days); "today" fixed a day after month-end so blocker 1 is
// closed by default in every test that does not override it.
const AFTER_MONTH_END = new Date("2026-08-01T03:00:00.000Z")

const bdtComponents = [
  { code: "HOUSE_RENT", label: "House rent", kind: "EARNING", calc: "PERCENT_OF_BASIC", value: dec(50), sortOrder: 1, countsAsWages: true },
  { code: "PF", label: "Provident fund", kind: "DEDUCTION", calc: "PERCENT_OF_BASIC", value: dec(10), sortOrder: 1, countsAsWages: false },
  { code: "TAX", label: "Income tax", kind: "DEDUCTION", calc: "FIXED", value: dec(2500), sortOrder: 2, countsAsWages: false },
]

const bdtStructure = {
  id: "struct-bdt",
  name: "Standard (BDT)",
  currency: "BDT" as const,
  basic: dec(50000),
  isActive: true,
  components: bdtComponents,
}

const usdStructure = {
  id: "struct-usd",
  name: "Standard (USD)",
  currency: "USD" as const,
  basic: dec(2000),
  isActive: true,
  components: bdtComponents,
}

function employeeRow(over: Record<string, unknown> = {}) {
  return {
    id: "emp-bdt",
    fullName: "Ayesha Rahman",
    employeeCode: "BS-EMP-001",
    salaryStructureId: "struct-bdt",
    salaryStructure: bdtStructure,
    ...over,
  }
}

function summaryFor(over: Partial<MonthlyAttendanceSummary> = {}): MonthlyAttendanceSummary {
  return {
    employee: { id: "emp-bdt", fullName: "Ayesha Rahman", employeeCode: "BS-EMP-001", designation: "Engineer" },
    month: 7,
    year: 2026,
    workingDays: 27,
    present: 27,
    absent: 0,
    onLeave: 0,
    onPaidLeave: 0,
    onUnpaidLeave: 0,
    notCheckedIn: 0,
    late: 0,
    earlyOut: 0,
    holidays: 2,
    weeklyOffs: 4,
    workedOnOffDays: 0,
    workedHours: 216,
    expectedHours: 216,
    shortfallHours: 0,
    missingCheckOut: 0,
    pendingApproval: 0,
    approved: 27,
    regularised: 0,
    rejected: 0,
    ...over,
  }
}

const usdRateRow = {
  id: "rate-1",
  base: "USD",
  quote: "BDT",
  rate: dec("122.5"),
  effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  createdBy: "user-1",
}

let idCounterValue = 0

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(AFTER_MONTH_END)
  idCounterValue = 0

  vi.mocked(prisma.employee.findMany).mockResolvedValue([employeeRow()] as never)
  vi.mocked(getMonthlySummary).mockResolvedValue([summaryFor()])
  vi.mocked(prisma.exchangeRate.findMany).mockResolvedValue([])
  tx.payrollAdjustment.findMany.mockResolvedValue([])
  tx.expenseClaim.findMany.mockResolvedValue([])
  tx.idCounter.upsert.mockImplementation(async () => {
    idCounterValue += 1
    return { id: "PAY", value: idCounterValue }
  })
  tx.payslip.create.mockImplementation(async ({ data }: any) => ({ id: `payslip-${data.employeeId}`, ...data }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("createRun", () => {
  it("400s a month that has not started yet", async () => {
    await expect(createRun("user-finance", { month: 12, year: 2026 })).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it("allows the current, still-in-progress month", async () => {
    tx.payrollRun.create.mockResolvedValue({ id: "run-1", month: 8, year: 2026 })
    await expect(createRun("user-finance", { month: 8, year: 2026 })).resolves.toMatchObject({
      id: "run-1",
    })
  })

  it("creates a past month and writes an audit row", async () => {
    tx.payrollRun.create.mockResolvedValue({ id: "run-1", month: 7, year: 2026 })
    await createRun("user-finance", { month: 7, year: 2026 })
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entity: "PAYROLL_RUN", action: "CREATE" }) })
    )
  })

  it("409s on the (month, year) unique — a duplicate run is a double payment", async () => {
    tx.payrollRun.create.mockRejectedValue(Object.assign(new Error("Unique constraint"), { code: "P2002" }))
    await expect(createRun("user-finance", { month: 7, year: 2026 })).rejects.toMatchObject({
      statusCode: 409,
    })
  })
})

describe("processRun", () => {
  const draftRun = { id: "run-1", month: 7, year: 2026, status: "DRAFT" }

  it("404s an unknown run", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(null)
    await expect(processRun("nope", "user-finance")).rejects.toMatchObject({ statusCode: 404 })
  })

  it("409s a run that is not DRAFT", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({ ...draftRun, status: "SUBMITTED" } as never)
    await expect(processRun("run-1", "user-finance")).rejects.toMatchObject({ statusCode: 409 })
  })

  it("409s with the preflight blockers when the month is not over", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(draftRun as never)
    vi.setSystemTime(new Date("2026-07-15T06:00:00.000Z"))
    const failure = processRun("run-1", "user-finance")
    await expect(failure).rejects.toMatchObject({ statusCode: 409 })
    await expect(failure).rejects.toMatchObject({
      details: { blockers: expect.arrayContaining([expect.objectContaining({ code: "MONTH_NOT_OVER" })]) },
    })
    expect(tx.payslip.deleteMany).not.toHaveBeenCalled()
  })

  it("deletes existing payslips before creating new ones — the idempotent rebuild", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(draftRun as never)
    tx.payrollRun.update.mockResolvedValue({ ...draftRun, processedAt: new Date() })
    const callOrder: string[] = []
    tx.payslip.deleteMany.mockImplementation(async () => {
      callOrder.push("delete")
      return { count: 1 }
    })
    tx.payslip.create.mockImplementation(async ({ data }: any) => {
      callOrder.push("create")
      return { id: `payslip-${data.employeeId}`, ...data }
    })
    await processRun("run-1", "user-finance")
    expect(callOrder).toEqual(["delete", "create"])
    expect(tx.payslip.deleteMany).toHaveBeenCalledWith({ where: { payrollRunId: "run-1" } })
  })

  it("creates exactly one payslip per roster employee, no more", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      employeeRow(),
      employeeRow({ id: "emp-2", fullName: "Second Employee", employeeCode: "BS-EMP-002" }),
    ] as never)
    vi.mocked(getMonthlySummary).mockResolvedValue([
      summaryFor(),
      summaryFor({ employee: { id: "emp-2", fullName: "Second Employee", employeeCode: "BS-EMP-002", designation: "Engineer" } }),
    ])
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(draftRun as never)
    tx.payrollRun.update.mockResolvedValue(draftRun)

    await processRun("run-1", "user-finance")
    expect(tx.payslip.create).toHaveBeenCalledTimes(2)
  })

  it("assigns a fresh payslipNo per employee from IdCounter", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(draftRun as never)
    tx.payrollRun.update.mockResolvedValue(draftRun)
    await processRun("run-1", "user-finance")
    expect(tx.payslip.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ payslipNo: "BS-PAY-000001" }) })
    )
  })

  it("reprocessing deletes-then-recreates on every call — no accumulation", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(draftRun as never)
    tx.payrollRun.update.mockResolvedValue(draftRun)
    await processRun("run-1", "user-finance")
    await processRun("run-1", "user-finance")
    expect(tx.payslip.deleteMany).toHaveBeenCalledTimes(2)
    // One create per employee per invocation — two calls, one employee each.
    expect(tx.payslip.create).toHaveBeenCalledTimes(2)
  })

  describe("a BDT employee", () => {
    it("gets fxRateToBdt exactly 1 and identical native/BDT columns", async () => {
      vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(draftRun as never)
      tx.payrollRun.update.mockResolvedValue(draftRun)
      await processRun("run-1", "user-finance")
      const call = tx.payslip.create.mock.calls[0][0]
      expect(call.data.fxRateToBdt.toFixed(6)).toBe("1.000000")
      expect(call.data.grossPayBdt.equals(call.data.grossPay)).toBe(true)
      expect(call.data.netPayBdt.equals(call.data.netPay)).toBe(true)
    })
  })

  describe("a USD employee", () => {
    beforeEach(() => {
      vi.mocked(prisma.employee.findMany).mockResolvedValue([
        employeeRow({ id: "emp-usd", salaryStructureId: "struct-usd", salaryStructure: usdStructure }),
      ] as never)
      vi.mocked(getMonthlySummary).mockResolvedValue([
        summaryFor({ employee: { id: "emp-usd", fullName: "Sam Lee", employeeCode: "BS-EMP-002", designation: "Engineer" } }),
      ])
      vi.mocked(prisma.exchangeRate.findMany).mockResolvedValue([usdRateRow] as never)
    })

    it("stamps the run's fxRateToBdt at 122.5 and converts every BDT total by it", async () => {
      vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({ id: "run-1", month: 7, year: 2026, status: "DRAFT" } as never)
      tx.payrollRun.update.mockResolvedValue({})
      await processRun("run-1", "user-finance")

      expect(tx.payrollRun.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ fxRateToBdt: expect.anything() }) })
      )
      const runUpdateArg = tx.payrollRun.update.mock.calls[0][0].data.fxRateToBdt
      expect(runUpdateArg.toFixed(1)).toBe("122.5")

      const call = tx.payslip.create.mock.calls[0][0]
      expect(call.data.fxRateToBdt.toFixed(1)).toBe("122.5")
      expect(call.data.grossPayBdt.equals(call.data.grossPay.times(dec("122.5")))).toBe(true)
      expect(call.data.netPayBdt.equals(call.data.netPay.times(dec("122.5")))).toBe(true)
    })
  })

  describe("adjustments", () => {
    it("sweeps an unclaimed adjustment and claims it on the new payslip", async () => {
      vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(draftRun as never)
      tx.payrollRun.update.mockResolvedValue(draftRun)
      tx.payrollAdjustment.findMany.mockResolvedValue([
        { id: "adj-1", employeeId: "emp-bdt", month: 7, year: 2026, kind: "EARNING", code: "FESTIVAL_BONUS", label: "Eid bonus", currency: "BDT", amount: dec(5000), reason: "Eid", createdBy: "hr-1", payslipId: null },
      ])
      await processRun("run-1", "user-finance")

      expect(tx.payrollAdjustment.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["adj-1"] } },
        data: { payslipId: "payslip-emp-bdt" },
      })
    })

    it("converts a BDT-entered adjustment into the USD payslip's currency before summing", async () => {
      vi.mocked(prisma.employee.findMany).mockResolvedValue([
        employeeRow({ id: "emp-usd", salaryStructureId: "struct-usd", salaryStructure: usdStructure }),
      ] as never)
      vi.mocked(getMonthlySummary).mockResolvedValue([
        summaryFor({ employee: { id: "emp-usd", fullName: "Sam Lee", employeeCode: "BS-EMP-002", designation: "Engineer" } }),
      ])
      vi.mocked(prisma.exchangeRate.findMany).mockResolvedValue([usdRateRow] as never)
      vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({ id: "run-1", month: 7, year: 2026, status: "DRAFT" } as never)
      tx.payrollRun.update.mockResolvedValue({})
      tx.payrollAdjustment.findMany.mockResolvedValue([
        { id: "adj-1", employeeId: "emp-usd", month: 7, year: 2026, kind: "EARNING", code: "ARREARS", label: "Arrears", currency: "BDT", amount: dec("6125.00"), reason: "Back pay", createdBy: "hr-1", payslipId: null },
      ])

      await processRun("run-1", "user-finance")
      const call = tx.payslip.create.mock.calls[0][0]
      // 6125 BDT / 122.5 = 50.00 USD, added to gross after pro-ration (full
      // attendance here, so grossPay = grossFull + 50).
      const breakdown = call.data.breakdown as { adjustments: Array<{ code: string; amount: string }> }
      const adjustmentLine = breakdown.adjustments.find((l) => l.code === "ARREARS")
      expect(adjustmentLine?.amount).toBe("50.00")
    })
  })

  describe("the expense sweep", () => {
    const approvedClaim = {
      id: "claim-1",
      employeeId: "emp-bdt",
      amount: dec("1200.00"),
      category: "Travel",
      currency: "BDT",
      expenseDate: new Date("2026-07-03T00:00:00.000Z"),
      fxRateToBdt: dec(1),
      status: "APPROVED",
    }

    it("only asks for APPROVED claims that no payslip or settlement has taken", async () => {
      vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(draftRun as never)
      tx.payrollRun.update.mockResolvedValue(draftRun)
      await processRun("run-1", "user-finance")
      expect(tx.expenseClaim.findMany).toHaveBeenCalledWith({
        where: {
          employeeId: { in: ["emp-bdt"] },
          status: "APPROVED",
          payslipId: null,
          settlementId: null,
        },
      })
    })

    it("adds the claim to netPayable without touching grossPay", async () => {
      vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(draftRun as never)
      tx.payrollRun.update.mockResolvedValue(draftRun)
      tx.expenseClaim.findMany.mockResolvedValue([approvedClaim])
      await processRun("run-1", "user-finance")
      const data = tx.payslip.create.mock.calls[0][0].data
      // A reimbursement returns money already spent: not wages, so outside
      // gross, and therefore never pro-rated by attendance.
      expect(data.reimbursements.toFixed(2)).toBe("1200.00")
      expect(data.netPayable.equals(data.netPay.plus(dec("1200.00")))).toBe(true)
      // Gross is exactly what a full month earns with no claim at all.
      expect(data.grossPay.equals(data.grossFull)).toBe(true)
    })

    it("claims the swept claim onto the new payslip", async () => {
      vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(draftRun as never)
      tx.payrollRun.update.mockResolvedValue(draftRun)
      tx.expenseClaim.findMany.mockResolvedValue([approvedClaim])
      await processRun("run-1", "user-finance")
      expect(tx.expenseClaim.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["claim-1"] } },
        data: { payslipId: "payslip-emp-bdt" },
      })
    })

    it("converts a BDT claim at its own frozen rate onto a USD payslip", async () => {
      // The claim crossed currency once, at approval, at its spend-date
      // rate. Only the hop into the payslip's currency remains.
      vi.mocked(prisma.employee.findMany).mockResolvedValue([
        employeeRow({ id: "emp-usd", salaryStructureId: "struct-usd", salaryStructure: usdStructure }),
      ] as never)
      vi.mocked(getMonthlySummary).mockResolvedValue([
        summaryFor({ employee: { id: "emp-usd", fullName: "Sam Lee", employeeCode: "BS-EMP-002", designation: "Engineer" } }),
      ])
      vi.mocked(prisma.exchangeRate.findMany).mockResolvedValue([usdRateRow] as never)
      vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({ id: "run-1", month: 7, year: 2026, status: "DRAFT" } as never)
      tx.payrollRun.update.mockResolvedValue({})
      tx.expenseClaim.findMany.mockResolvedValue([
        { ...approvedClaim, employeeId: "emp-usd", amount: dec("6125.00"), fxRateToBdt: dec(1) },
      ])
      await processRun("run-1", "user-finance")
      const data = tx.payslip.create.mock.calls[0][0].data
      // 6125 BDT / 122.5 = 50.00 USD
      expect(data.reimbursements.toFixed(2)).toBe("50.00")
    })
  })

  describe("negative net pay", () => {
    it("409s and does not write any payslip", async () => {
      vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(draftRun as never)
      vi.mocked(getMonthlySummary).mockResolvedValue([summaryFor({ present: 1, absent: 30 })])
      await expect(processRun("run-1", "user-finance")).rejects.toMatchObject({ statusCode: 409 })
      expect(tx.payslip.create).not.toHaveBeenCalled()
    })
  })
})

describe("submitRun", () => {
  it("409s a run that has not been processed", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({
      id: "run-1",
      status: "DRAFT",
      processedAt: null,
    } as never)
    await expect(submitRun("run-1", "user-finance")).rejects.toMatchObject({ statusCode: 409 })
  })

  it("409s a run already submitted", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({
      id: "run-1",
      status: "SUBMITTED",
      processedAt: new Date(),
    } as never)
    await expect(submitRun("run-1", "user-finance")).rejects.toMatchObject({ statusCode: 409 })
  })

  it("moves a processed draft to SUBMITTED", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({
      id: "run-1",
      status: "DRAFT",
      processedAt: new Date(),
    } as never)
    tx.payrollRun.update.mockResolvedValue({ id: "run-1", status: "SUBMITTED" })
    await expect(submitRun("run-1", "finance-1")).resolves.toMatchObject({ status: "SUBMITTED" })
    expect(tx.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SUBMITTED", submittedBy: "finance-1" }) })
    )
  })

  it("emails every active Super Admin when a run is submitted", async () => {
    // Fanned out rather than picked: any of them can approve, and choosing
    // one makes payday wait on whoever is away.
    vi.mocked(activeSuperAdminEmails).mockResolvedValue(["sa1@b.com", "sa2@b.com"])
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({
      id: "run-1",
      status: "DRAFT",
      month: 9,
      year: 2026,
      processedAt: new Date(),
    } as never)
    tx.payrollRun.update.mockResolvedValue({ id: "run-1", status: "SUBMITTED" })

    await submitRun("run-1", "finance-1")

    expect(sendPayrollSubmittedEmail).toHaveBeenCalledTimes(2)
    expect(sendPayrollSubmittedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "sa1@b.com", runId: "run-1", month: 9, year: 2026 })
    )
  })
})

describe("approveRun", () => {
  it("403s when the approver is the submitter", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({
      id: "run-1",
      status: "SUBMITTED",
      submittedBy: "finance-1",
    } as never)
    await expect(approveRun("run-1", "finance-1")).rejects.toMatchObject({ statusCode: 403 })
  })

  it("409s a run that is not SUBMITTED", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({
      id: "run-1",
      status: "DRAFT",
      submittedBy: null,
    } as never)
    await expect(approveRun("run-1", "admin-1")).rejects.toMatchObject({ statusCode: 409 })
  })

  it("succeeds for a different Super Admin", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({
      id: "run-1",
      status: "SUBMITTED",
      submittedBy: "finance-1",
    } as never)
    tx.payrollRun.update.mockResolvedValue({ id: "run-1", status: "APPROVED" })
    await expect(approveRun("run-1", "admin-1")).resolves.toMatchObject({ status: "APPROVED" })
  })
})

describe("run lifecycle events", () => {
  const emitted = () => tx.event.create.mock.calls.map((c: any) => c[0].data)

  const submitted = (over: Record<string, unknown> = {}) => ({
    id: "run-1",
    month: 7,
    year: 2026,
    status: "SUBMITTED",
    submittedBy: "finance-1",
    processedAt: new Date(),
    fxRateToBdt: null,
    ...over,
  })

  it("emits payroll.run.submitted as WARNING — somebody now has to act", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(
      submitted({ status: "DRAFT" }) as never
    )
    tx.payrollRun.update.mockResolvedValue({ id: "run-1" })

    await submitRun("run-1", "finance-1")
    expect(emitted()[0]).toMatchObject({
      type: "payroll.run.submitted",
      severity: "WARNING",
      entity: "PAYROLL_RUN",
      entityId: "run-1",
      targetRoles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      title: "July 2026 payroll submitted for approval",
    })
  })

  it("carries no amount on any run event", async () => {
    // The company's monthly wage bill is not a number that belongs on a card
    // Finance shares in a standup.
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(submitted() as never)
    tx.payrollRun.update.mockResolvedValue({ id: "run-1" })

    await approveRun("run-1", "admin-1")
    for (const event of emitted()) {
      expect(JSON.stringify(event)).not.toMatch(/grossPay|netPayable|totalCost/)
    }
  })

  it("emits one payslip.published per employee when the run is approved", async () => {
    // Approval is the moment `visibleRunFilter` starts admitting the payslip
    // to the person it belongs to, so it is the moment to say so.
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(submitted() as never)
    tx.payrollRun.update.mockResolvedValue({ id: "run-1" })
    tx.payslip.findMany.mockResolvedValue([
      { id: "slip-1", employeeId: "emp-1" },
      { id: "slip-2", employeeId: "emp-2" },
    ])

    await approveRun("run-1", "admin-1")
    const events = emitted()
    // One run event plus one per employee. N events for N recipients is not
    // a bulk-rule violation: each employee is told exactly once about their
    // own payslip.
    expect(events).toHaveLength(3)
    expect(events[0].type).toBe("payroll.run.approved")
    expect(events.slice(1).map((e: any) => e.type)).toEqual([
      "payslip.published",
      "payslip.published",
    ])
  })

  it("names no figure on a payslip event and resolves no manager", async () => {
    // A manager may not see their reports' payslips — letting emitEvent
    // resolve a reporting line here would route pay past that rule.
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(submitted() as never)
    tx.payrollRun.update.mockResolvedValue({ id: "run-1" })
    tx.payslip.findMany.mockResolvedValue([{ id: "slip-1", employeeId: "emp-1" }])

    await approveRun("run-1", "admin-1")
    const slip = emitted()[1]
    expect(slip.title).toBe("Your July 2026 payslip is ready")
    expect(slip.subjectEmployeeId).toBe("emp-1")
    expect(slip.managerEmployeeId).toBeNull()
    expect(slip.targetRoles).toEqual([])
    expect(tx.employee.findUnique).not.toHaveBeenCalled()
  })

  it("emits one expense.reimbursed per swept claim when a run is disbursed", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(
      submitted({ status: "APPROVED" }) as never
    )
    tx.payrollRun.update.mockResolvedValue({ id: "run-1" })
    tx.expenseClaim.findMany.mockResolvedValue([
      { id: "claim-1", employeeId: "emp-1", category: "Travel", amount: dec(1200), currency: "BDT" },
      { id: "claim-2", employeeId: "emp-2", category: "Meals", amount: dec(400), currency: "BDT" },
    ])

    await disburseRun("run-1", "finance-1")
    const types = emitted().map((e: any) => e.type)
    expect(types).toEqual([
      "expense.reimbursed",
      "expense.reimbursed",
      "payroll.run.disbursed",
    ])
  })

  it("reads the claims before the sweep, since afterwards nothing marks them", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(
      submitted({ status: "APPROVED" }) as never
    )
    tx.payrollRun.update.mockResolvedValue({ id: "run-1" })
    tx.expenseClaim.findMany.mockResolvedValue([])

    await disburseRun("run-1", "finance-1")
    expect(tx.expenseClaim.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.expenseClaim.updateMany.mock.invocationCallOrder[0]
    )
  })
})

describe("rejectRun", () => {
  it("409s a run that is not SUBMITTED", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({ id: "run-1", status: "DRAFT" } as never)
    await expect(rejectRun("run-1", "admin-1", { note: "Needs a fix" })).rejects.toMatchObject({
      statusCode: 409,
    })
  })

  it("returns to DRAFT with the note recorded", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({ id: "run-1", status: "SUBMITTED" } as never)
    tx.payrollRun.update.mockResolvedValue({ id: "run-1", status: "DRAFT", rejectionNote: "Needs a fix" })
    const result = await rejectRun("run-1", "admin-1", { note: "Needs a fix" })
    expect(result).toMatchObject({ status: "DRAFT", rejectionNote: "Needs a fix" })
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "REJECT", note: "Needs a fix" }) })
    )
  })
})

describe("disburseRun", () => {
  it("409s a run that is not APPROVED", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({ id: "run-1", status: "SUBMITTED" } as never)
    await expect(disburseRun("run-1", "finance-1")).rejects.toMatchObject({ statusCode: 409 })
  })

  it("is terminal — 409s a run already DISBURSED", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({ id: "run-1", status: "DISBURSED" } as never)
    await expect(disburseRun("run-1", "finance-1")).rejects.toMatchObject({ statusCode: 409 })
  })

  it("marks swept expense claims REIMBURSED, scoped to this run's payslips", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({
      id: "run-1",
      status: "APPROVED",
      fxRateToBdt: null,
    } as never)
    tx.payrollRun.update.mockResolvedValue({ id: "run-1", status: "DISBURSED" })
    await disburseRun("run-1", "finance-1")
    expect(tx.expenseClaim.updateMany).toHaveBeenCalledWith({
      where: { payslip: { payrollRunId: "run-1" }, status: "APPROVED" },
      data: { status: "REIMBURSED" },
    })
  })

  it("sweeps the recoveries its adjustments carried, scoped to this run's payslips", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({
      id: "run-1",
      status: "APPROVED",
      fxRateToBdt: null,
    } as never)
    tx.payrollRun.update.mockResolvedValue({ id: "run-1", status: "DISBURSED" })
    tx.assetRecovery.findMany.mockResolvedValue([
      { id: "rec-1", employeeId: "emp-1", assetId: "a-1", amount: dec("45000"), currency: "BDT", asset: { assetTag: "BS-AST-00001" } },
    ] as never)

    await disburseRun("run-1", "finance-1")

    expect(tx.assetRecovery.updateMany).toHaveBeenCalledWith({
      where: { status: "PENDING", adjustment: { payslip: { payrollRunId: "run-1" } } },
      data: { status: "RECOVERED" },
    })
  })

  it("resolves a fresh disbursement rate only when the run used a foreign currency", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({
      id: "run-1",
      status: "APPROVED",
      fxRateToBdt: dec("122.5"),
    } as never)
    vi.mocked(prisma.exchangeRate.findMany).mockResolvedValue([usdRateRow] as never)
    tx.payrollRun.update.mockResolvedValue({ id: "run-1", status: "DISBURSED" })
    await disburseRun("run-1", "finance-1")
    expect(tx.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ disbursementFxRateToBdt: expect.anything() }),
      })
    )
  })
})

/**
 * The guarantee the whole seam exists for: a posting shares the caller's
 * transaction, so accounting can refuse a payday and the business action goes
 * back with it. There is no window in which a run is disbursed and the ledger
 * does not know.
 *
 * A mocked `$transaction` cannot roll anything back, so these assert the two
 * things that make the real rollback work — the posting runs inside the same
 * `tx`, and its failure propagates rather than being swallowed. The end-to-end
 * proof is the manual smoke test against a real database.
 */
describe("the accounting seam", () => {
  const approved = () =>
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({
      id: "run-1", status: "APPROVED", fxRateToBdt: null,
    } as never)

  it("posts the accrual inside the same transaction that approves the run", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({
      id: "run-1", status: "SUBMITTED", submittedBy: "hr-1",
    } as never)
    tx.payrollRun.update.mockResolvedValue({ id: "run-1", status: "APPROVED" })

    await approveRun("run-1", "admin-1")

    expect(postPayrollAccrual).toHaveBeenCalledWith(tx, "run-1", "admin-1")
  })

  it("posts the payment inside the same transaction that disburses", async () => {
    approved()
    tx.payrollRun.update.mockResolvedValue({ id: "run-1", status: "DISBURSED" })

    await disburseRun("run-1", "finance-1")

    expect(postPayrollPayment).toHaveBeenCalledWith(tx, "run-1", "finance-1")
  })

  it("refuses the disbursement when the accounting period is closed", async () => {
    approved()
    tx.payrollRun.update.mockResolvedValue({ id: "run-1", status: "DISBURSED" })
    vi.mocked(postPayrollPayment).mockRejectedValueOnce(
      new AppError(409, "August 2026 is closed. Reopen it to post into it.")
    )

    await expect(disburseRun("run-1", "finance-1")).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("closed"),
    })
  })

  it("refuses the approval when the run's own month is closed", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({
      id: "run-1", status: "SUBMITTED", submittedBy: "hr-1",
    } as never)
    tx.payrollRun.update.mockResolvedValue({ id: "run-1", status: "APPROVED" })
    vi.mocked(postPayrollAccrual).mockRejectedValueOnce(
      new AppError(409, "July 2026 is closed. Reopen it to post into it.")
    )

    await expect(approveRun("run-1", "admin-1")).rejects.toMatchObject({ statusCode: 409 })
  })

  /**
   * Decision 13. `postSystemJournal` answers a duplicate with the journal that
   * already exists, which is only safe because APPROVED is a one-way door:
   * `processRun` requires DRAFT and `rejectRun` requires SUBMITTED, so the
   * figures cannot change after the journal posts. Asserted rather than
   * assumed, because the failure would be silent — a second approval would
   * return the *first* journal and leave the ledger holding superseded
   * figures with nothing complaining.
   */
  it("cannot re-approve an approved run, which is what makes the idempotency safe", async () => {
    approved()

    await expect(approveRun("run-1", "admin-1")).rejects.toMatchObject({ statusCode: 409 })
    expect(postPayrollAccrual).not.toHaveBeenCalled()
  })

  it("cannot re-process an approved run back into an editable state", async () => {
    approved()

    await expect(processRun("run-1", "finance-1")).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe("every illegal transition 409s", () => {
  it("process on an APPROVED run", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({ id: "run-1", status: "APPROVED" } as never)
    await expect(processRun("run-1", "user-finance")).rejects.toMatchObject({ statusCode: 409 })
  })

  it("submit on a SUBMITTED run", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({
      id: "run-1",
      status: "SUBMITTED",
      processedAt: new Date(),
    } as never)
    await expect(submitRun("run-1", "user-finance")).rejects.toMatchObject({ statusCode: 409 })
  })

  it("disburse on a DRAFT run", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({ id: "run-1", status: "DRAFT" } as never)
    await expect(disburseRun("run-1", "user-finance")).rejects.toMatchObject({ statusCode: 409 })
  })

  it.each(["process", "submit", "approve", "reject", "disburse"] as const)(
    "%s on a DISBURSED run",
    async (action) => {
      vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({ id: "run-1", status: "DISBURSED" } as never)
      const attempt =
        action === "process"
          ? processRun("run-1", "u")
          : action === "submit"
            ? submitRun("run-1", "u")
            : action === "approve"
              ? approveRun("run-1", "u")
              : action === "reject"
                ? rejectRun("run-1", "u", { note: "x" })
                : disburseRun("run-1", "u")
      await expect(attempt).rejects.toMatchObject({ statusCode: 409 })
    }
  )
})
