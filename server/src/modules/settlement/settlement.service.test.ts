import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => {
  const tx = {
    settlement: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    expenseClaim: { updateMany: vi.fn(), findMany: vi.fn(async () => []) },
    assetRecovery: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
    idCounter: { upsert: vi.fn() },
    auditLog: { create: vi.fn() },
    // The event log, written in the same transaction. Distinct from
    // auditLog: one row per user action rather than per record.
    event: { create: vi.fn() },
    employee: { update: vi.fn(), findUnique: vi.fn() },
  }
  return {
    default: {
      settlement: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
      employee: { findUnique: vi.fn() },
      expenseClaim: { findMany: vi.fn() },
      exchangeRate: { findMany: vi.fn() },
      payrollRun: { findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  }
})

vi.mock("../attendance/attendance.summary", () => ({
  getMonthlySummary: vi.fn(),
}))

vi.mock("./settlement.posting", () => ({
  postSettlementAccrual: vi.fn(),
  postSettlementPayment: vi.fn(),
}))

vi.mock("../notification/notification.mailer", () => ({
  sendSettlementStatementEmail: vi.fn(() => Promise.resolve()),
}))

import { sendSettlementStatementEmail } from "../notification/notification.mailer"
import prisma from "../../config/prisma"
import { getMonthlySummary } from "../attendance/attendance.summary"
import type { MonthlyAttendanceSummary } from "../attendance/attendance.types"
import { dec } from "../payroll/payroll.money"
import { parseDateOnly } from "../../utils/dates"
import {
  approveSettlement,
  calculateSettlement,
  overrideSettlement,
  paySettlement,
} from "./settlement.service"

const tx = (prisma as unknown as { __tx: any }).__tx

const components = [
  { code: "HOUSE_RENT", label: "House rent", kind: "EARNING", calc: "PERCENT_OF_BASIC", value: dec(50), sortOrder: 1, countsAsWages: true },
  { code: "MEDICAL", label: "Medical", kind: "EARNING", calc: "FIXED", value: dec(3000), sortOrder: 2, countsAsWages: true },
  { code: "PF", label: "Provident fund", kind: "DEDUCTION", calc: "PERCENT_OF_BASIC", value: dec(10), sortOrder: 1, countsAsWages: false },
]

function employeeRow(over: Record<string, unknown> = {}) {
  return {
    id: "emp-1",
    fullName: "Ayesha Rahman",
    employeeCode: "BS-EMP-001",
    joiningDate: parseDateOnly("2020-01-06"),
    lastWorkingDay: parseDateOnly("2026-07-15"),
    exitReason: "RESIGNATION",
    employmentStatus: "RESIGNED",
    salaryStructure: {
      id: "struct-bdt",
      name: "Standard (BDT)",
      currency: "BDT",
      basic: dec(50000),
      isActive: true,
      components,
    },
    ...over,
  }
}

function summaryFor(over: Partial<MonthlyAttendanceSummary> = {}): MonthlyAttendanceSummary {
  return {
    employee: { id: "emp-1", fullName: "Ayesha Rahman", employeeCode: "BS-EMP-001", designation: "Engineer" },
    month: 7, year: 2026, workingDays: 12, present: 12, absent: 0, onLeave: 0,
    onPaidLeave: 0, onUnpaidLeave: 0, notCheckedIn: 0, late: 0, earlyOut: 0,
    holidays: 1, weeklyOffs: 2, workedOnOffDays: 0, workedHours: 108,
    workedHoursOnWorkingDays: 108, workingDaysFullyRecorded: 12,
    expectedHours: 108, shortfallHours: 0, missingCheckOut: 0,
    pendingApproval: 0, approved: 12, regularised: 0, rejected: 0,
    ...over,
  }
}

let counter = 0

beforeEach(() => {
  counter = 0
  vi.mocked(prisma.employee.findUnique).mockResolvedValue(employeeRow() as never)
  vi.mocked(prisma.settlement.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.expenseClaim.findMany).mockResolvedValue([])
  ;(tx.assetRecovery.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
  vi.mocked(getMonthlySummary).mockResolvedValue([summaryFor()])
  tx.idCounter.upsert.mockImplementation(async () => ({ id: "STL", value: ++counter }))
  // `employee` and `settlementNo` ride along because every write is followed
  // by an event that names the leaver — the include is real, so the fake
  // has to carry it.
  const included = { employee: { id: "emp-1", fullName: "Tanvir Hasan" }, settlementNo: "BS-STL-000001" }
  tx.settlement.create.mockImplementation(async ({ data }: any) => ({
    id: "stl-1",
    ...included,
    ...data,
  }))
  tx.settlement.update.mockImplementation(async ({ data }: any) => ({
    id: "stl-1",
    employeeId: "emp-1",
    ...included,
    ...data,
  }))
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("calculateSettlement", () => {
  it("404s an unknown employee", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null)
    await expect(calculateSettlement("nope", "fin-1")).rejects.toMatchObject({ statusCode: 404 })
  })

  it("409s when the employee has no exit details", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(
      employeeRow({ lastWorkingDay: null, exitReason: null }) as never
    )
    await expect(calculateSettlement("emp-1", "fin-1")).rejects.toMatchObject({ statusCode: 409 })
  })

  it("409s when the exit month still has unapproved attendance", async () => {
    // A leaver's final days are exactly the ones most likely to be pending.
    vi.mocked(getMonthlySummary).mockResolvedValue([summaryFor({ pendingApproval: 2 })])
    await expect(calculateSettlement("emp-1", "fin-1")).rejects.toMatchObject({ statusCode: 409 })
    expect(tx.settlement.create).not.toHaveBeenCalled()
  })

  it("409s when a settlement is already approved", async () => {
    vi.mocked(prisma.settlement.findFirst).mockResolvedValue({ id: "stl-0", status: "APPROVED" } as never)
    await expect(calculateSettlement("emp-1", "fin-1")).rejects.toMatchObject({ statusCode: 409 })
  })

  it("computes pendingSalary over only the days up to the exit date", async () => {
    await calculateSettlement("emp-1", "fin-1")
    const data = tx.settlement.create.mock.calls[0][0].data
    const breakdown = data.breakdown as { pendingSalary: { daysEmployed: number; payableDays: string } }
    expect(breakdown.pendingSalary.daysEmployed).toBe(15)
    expect(breakdown.pendingSalary.payableDays).toBe("15.00")
  })

  it("computes gratuity on the countsAsWages base and shows its working", async () => {
    // Basic 50,000 + house rent 25,000 + medical 3,000 = 78,000. Joined
    // 2020-01-06, left 2026-07-15 → 6 completed years → 30 days each.
    await calculateSettlement("emp-1", "fin-1")
    const data = tx.settlement.create.mock.calls[0][0].data
    expect(data.gratuity.toFixed(2)).toBe("468000.00")
    const breakdown = data.breakdown as { gratuity: { reason: string } }
    expect(breakdown.gratuity.reason).toContain("30 days × 6 completed year(s)")
  })

  it("pays no gratuity on a dismissal for misconduct", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(
      employeeRow({ exitReason: "DISMISSAL" }) as never
    )
    await calculateSettlement("emp-1", "fin-1")
    expect(tx.settlement.create.mock.calls[0][0].data.gratuity.toFixed(2)).toBe("0.00")
  })

  it("writes leaveEncashment as zero this phase", async () => {
    await calculateSettlement("emp-1", "fin-1")
    expect(tx.settlement.create.mock.calls[0][0].data.leaveEncashment.toFixed(2)).toBe("0.00")
  })

  it("sweeps an outstanding claim onto the settlement rather than orphaning it", async () => {
    vi.mocked(prisma.expenseClaim.findMany).mockResolvedValue([
      { id: "claim-1", amount: dec("1200.00"), currency: "BDT", fxRateToBdt: dec(1), category: "Travel" },
    ] as never)
    await calculateSettlement("emp-1", "fin-1")
    expect(tx.settlement.create.mock.calls[0][0].data.expenseReimbursement.toFixed(2)).toBe("1200.00")
    expect(tx.expenseClaim.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["claim-1"] } },
      data: { settlementId: "stl-1" },
    })
  })

  it("is an idempotent rebuild — an existing draft is deleted and its claims released", async () => {
    vi.mocked(prisma.settlement.findFirst).mockResolvedValue({ id: "stl-old", status: "DRAFT" } as never)
    await calculateSettlement("emp-1", "fin-1")
    expect(tx.expenseClaim.updateMany).toHaveBeenCalledWith({
      where: { settlementId: "stl-old" },
      data: { settlementId: null },
    })
    expect(tx.settlement.delete).toHaveBeenCalledWith({ where: { id: "stl-old" } })
  })

  it("satisfies the finalAmount identity", async () => {
    await calculateSettlement("emp-1", "fin-1")
    const d = tx.settlement.create.mock.calls[0][0].data
    const expected = d.pendingSalary
      .plus(d.gratuity)
      .plus(d.noticePay)
      .plus(d.expenseReimbursement)
      .plus(d.leaveEncashment)
      .minus(d.outstandingDeductions)
    expect(d.finalAmount.equals(expected)).toBe(true)
  })
})

describe("approveSettlement", () => {
  it("403s when the approver calculated it", async () => {
    vi.mocked(prisma.settlement.findUnique).mockResolvedValue({
      id: "stl-1",
      status: "DRAFT",
      calculatedBy: "fin-1",
    } as never)
    await expect(approveSettlement("stl-1", "fin-1")).rejects.toMatchObject({ statusCode: 403 })
  })

  it("succeeds for a different approver", async () => {
    vi.mocked(prisma.settlement.findUnique).mockResolvedValue({
      id: "stl-1",
      status: "DRAFT",
      calculatedBy: "fin-1",
    } as never)
    await expect(approveSettlement("stl-1", "admin-1")).resolves.toMatchObject({ status: "APPROVED" })
  })

  it("409s a settlement already approved", async () => {
    vi.mocked(prisma.settlement.findUnique).mockResolvedValue({
      id: "stl-1",
      status: "APPROVED",
      calculatedBy: "fin-1",
    } as never)
    await expect(approveSettlement("stl-1", "admin-1")).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe("paySettlement", () => {
  it("409s a settlement that is not approved", async () => {
    vi.mocked(prisma.settlement.findUnique).mockResolvedValue({ id: "stl-1", status: "DRAFT" } as never)
    await expect(paySettlement("stl-1", "fin-1")).rejects.toMatchObject({ statusCode: 409 })
  })

  it("marks swept claims REIMBURSED", async () => {
    vi.mocked(prisma.settlement.findUnique).mockResolvedValue({ id: "stl-1", status: "APPROVED" } as never)
    await paySettlement("stl-1", "fin-1")
    expect(tx.expenseClaim.updateMany).toHaveBeenCalledWith({
      where: { settlementId: "stl-1", status: "APPROVED" },
      data: { status: "REIMBURSED" },
    })
  })

  it("sweeps the recoveries it folded into its assetRecoveries head", async () => {
    vi.mocked(prisma.settlement.findUnique).mockResolvedValue({ id: "stl-1", status: "APPROVED" } as never)
    tx.assetRecovery.findMany.mockResolvedValue([
      { id: "rec-1", employeeId: "emp-1", assetId: "a-1", amount: dec("45000"), currency: "BDT", asset: { assetTag: "BS-AST-00001" } },
    ] as never)

    await paySettlement("stl-1", "fin-1")

    expect(tx.assetRecovery.updateMany).toHaveBeenCalledWith({
      where: { settlementId: "stl-1", status: "PENDING" },
      data: { status: "RECOVERED" },
    })
  })

  it("is terminal — 409s a settlement already paid", async () => {
    vi.mocked(prisma.settlement.findUnique).mockResolvedValue({ id: "stl-1", status: "PAID" } as never)
    await expect(paySettlement("stl-1", "fin-1")).rejects.toMatchObject({ statusCode: 409 })
  })

  it("emails the leaver their statement, omitting the heads worth nothing", async () => {
    // There is no settlement PDF renderer, so the working goes in the body.
    // A zero head is left out rather than printed as 0 — "Leave encashment:
    // 0" teaches the reader nothing except that a line exists.
    vi.mocked(prisma.settlement.findUnique).mockResolvedValue({
      id: "stl-1",
      status: "APPROVED",
      currency: "BDT",
      finalAmount: dec("58000"),
      pendingSalary: dec("0"),
      gratuity: dec("50000"),
      noticePay: dec("8000"),
      expenseReimbursement: dec("0"),
      leaveEncashment: dec("0"),
      outstandingDeductions: dec("0"),
      assetRecoveries: dec("0"),
      employee: { fullName: "A Person", user: { email: "leaver@b.com" } },
    } as never)

    await paySettlement("stl-1", "fin-1")

    expect(sendSettlementStatementEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "leaver@b.com",
        settlementId: "stl-1",
        fullName: "A Person",
        netPayable: "58000.00",
        lines: [
          { label: "Gratuity", amount: "50000.00" },
          { label: "Notice pay", amount: "8000.00" },
        ],
      })
    )
  })

  it("does not email a leaver with no account", async () => {
    vi.mocked(prisma.settlement.findUnique).mockResolvedValue({
      id: "stl-1",
      status: "APPROVED",
      employee: { fullName: "A Person", user: null },
    } as never)

    await paySettlement("stl-1", "fin-1")

    expect(sendSettlementStatementEmail).not.toHaveBeenCalled()
  })
})

describe("the settlement is not blocked by the exit checklist", () => {
  /**
   * Decision 6, asserted rather than assumed, because it is the rule most
   * likely to be "fixed" by someone who reads a checklist as a gate.
   * Withholding a statutory settlement as leverage over company property is
   * contentious in Bangladesh besides.
   */
  it("builds a settlement for an employee holding an unreturned laptop", async () => {
    // The checklist is a read surfaced in the UI; the calculation path never
    // consults recoveries or assignments, so an outstanding item cannot gate
    // it. The mock pinning that: a pending recovery exists, and the create
    // still runs.
    ;(tx.assetRecovery.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "rec-1", employeeId: "emp-1", assetId: "a-1", amount: dec("45000"), currency: "BDT", asset: { assetTag: "BS-AST-00001" } },
    ] as never)

    await expect(calculateSettlement("emp-1", "fin-1")).resolves.toBeTruthy()
  })

  it("pays a settlement while a pending recovery is outstanding", async () => {
    vi.mocked(prisma.settlement.findUnique).mockResolvedValue({ id: "stl-1", status: "APPROVED" } as never)
    ;(tx.assetRecovery.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "rec-1", employeeId: "emp-1", assetId: "a-1", amount: dec("45000"), currency: "BDT", asset: { assetTag: "BS-AST-00001" } },
    ] as never)

    await expect(paySettlement("stl-1", "fin-1")).resolves.toBeTruthy()
  })
})

describe("settlement events", () => {
  const emitted = () => tx.event.create.mock.calls.map((c: any) => c[0].data)

  it("emits settlement.calculated at Finance and Super Admin", async () => {
    await calculateSettlement("emp-1", "fin-1")
    expect(emitted()[0]).toMatchObject({
      type: "settlement.calculated",
      entity: "SETTLEMENT",
      subjectEmployeeId: "emp-1",
      targetRoles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      title: "Final settlement calculated",
    })
  })

  it("names no figure, and resolves no manager", async () => {
    // A settlement figure is the most sensitive number this system holds —
    // somebody's exit, often a contested one. The leaver's manager has no
    // part in the workflow either.
    await calculateSettlement("emp-1", "fin-1")
    const event = emitted()[0]
    // The leaver and the reference, and nothing else. `payload` carries the
    // settlementNo too, and deliberately not finalAmount.
    expect(event.meta).toBe("Tanvir Hasan · BS-STL-000001")
    expect(JSON.stringify(event)).not.toContain("finalAmount")
    expect(event.payload).toEqual({ stage: "calculated", settlementNo: "BS-STL-000001" })
    expect(event.managerEmployeeId).toBeNull()
    expect(tx.employee.findUnique).not.toHaveBeenCalled()
  })

  it("emits settlement.approved as WARNING — somebody now has to pay it", async () => {
    vi.mocked(prisma.settlement.findUnique).mockResolvedValue({
      id: "stl-1",
      status: "DRAFT",
      calculatedBy: "fin-1",
    } as never)
    await approveSettlement("stl-1", "admin-1")
    expect(emitted()[0]).toMatchObject({ type: "settlement.approved", severity: "WARNING" })
  })

  it("emits one expense.reimbursed per swept claim, then settlement.paid", async () => {
    vi.mocked(prisma.settlement.findUnique).mockResolvedValue({
      id: "stl-1",
      status: "APPROVED",
    } as never)
    tx.expenseClaim.findMany.mockResolvedValue([
      { id: "claim-1", employeeId: "emp-1", category: "Travel", amount: dec(1200), currency: "BDT" },
    ])

    await paySettlement("stl-1", "fin-1")
    expect(emitted().map((e: any) => e.type)).toEqual(["expense.reimbursed", "settlement.paid"])
  })
})

describe("overrideSettlement", () => {
  const draft = {
    id: "stl-1",
    status: "DRAFT",
    pendingSalary: dec("38709.68"),
    gratuity: dec("468000.00"),
    noticePay: dec(0),
    expenseReimbursement: dec(0),
    leaveEncashment: dec(0),
    outstandingDeductions: dec(0),
    assetRecoveries: dec(0),
    finalAmount: dec("506709.68"),
    fxRateToBdt: dec(1),
  }

  it("409s once the settlement is approved", async () => {
    vi.mocked(prisma.settlement.findUnique).mockResolvedValue({ ...draft, status: "APPROVED" } as never)
    await expect(
      overrideSettlement("stl-1", "fin-1", { gratuity: 0, reason: "Disputed under §23" })
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it("recomputes finalAmount from the overridden head", async () => {
    vi.mocked(prisma.settlement.findUnique).mockResolvedValue(draft as never)
    await overrideSettlement("stl-1", "fin-1", { gratuity: 0, reason: "Forfeited under §23" })
    const data = tx.settlement.update.mock.calls[0][0].data
    expect(data.gratuity.toFixed(2)).toBe("0.00")
    expect(data.finalAmount.toFixed(2)).toBe("38709.68")
  })

  it("audits the override with before, after and the reason", async () => {
    // A system that silently arbitrated a §23 dispute would be worse than
    // one that shows its working and lets a human overrule it.
    vi.mocked(prisma.settlement.findUnique).mockResolvedValue(draft as never)
    await overrideSettlement("stl-1", "fin-1", { gratuity: 0, reason: "Forfeited under §23" })
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "SETTLEMENT",
          action: "UPDATE",
          note: "Forfeited under §23",
          before: expect.objectContaining({ gratuity: "468000.00" }),
          after: expect.objectContaining({ gratuity: "0.00" }),
        }),
      })
    )
  })
})
