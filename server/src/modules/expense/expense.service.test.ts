import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => {
  const tx = {
    expenseClaim: { create: vi.fn(), update: vi.fn() },
    expenseCategory: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    // The event log, written in the same transaction. Distinct from
    // auditLog: one row per user action rather than per record.
    event: { create: vi.fn() },
    employee: { findUnique: vi.fn() },
  }
  return {
    default: {
      expenseClaim: { findMany: vi.fn(), findUnique: vi.fn() },
      exchangeRate: { findMany: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  }
})

vi.mock("../attendance/attendance.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../attendance/attendance.service")>()),
  requireEmployeeForUser: vi.fn(),
}))
vi.mock("./expense.posting", () => ({ postExpenseAccrual: vi.fn() }))
vi.mock("../notification/notification.mailer", () => ({
  sendExpenseDecidedEmail: vi.fn(() => Promise.resolve()),
}))

import prisma from "../../config/prisma"
import { requireEmployeeForUser } from "../attendance/attendance.service"
import { sendExpenseDecidedEmail } from "../notification/notification.mailer"
import { dec } from "../payroll/payroll.money"
import { approveClaim, createClaim, rejectClaim } from "./expense.service"

const tx = (prisma as unknown as { __tx: any }).__tx

const NOW = new Date("2026-08-15T06:00:00.000Z")
const actor = (role = "EMPLOYEE") =>
  ({ sub: "user-1", role, email: "a@demo.com", mustChangePassword: false }) as never

const validClaim = {
  name: "Water jar",
  amount: 1200,
  categoryId: "11111111-1111-1111-1111-111111111111",
  currency: "BDT" as const,
  expenseDate: "2026-08-03",
}

// The spend-date rate (122.0 on 3 July) deliberately differs from the
// month-end rate (122.5 effective 1 August), so a test can prove which one
// approval actually froze.
const julyRate = {
  id: "rate-jul",
  base: "USD",
  quote: "BDT",
  rate: dec("122.0"),
  effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  createdBy: "u",
}
const augustRate = {
  id: "rate-aug",
  base: "USD",
  quote: "BDT",
  rate: dec("122.5"),
  effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  createdBy: "u",
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.mocked(requireEmployeeForUser).mockResolvedValue({ id: "emp-1" } as never)
  tx.expenseClaim.create.mockImplementation(async ({ data }: any) => ({ id: "claim-1", ...data }))
  tx.expenseClaim.update.mockImplementation(async ({ data }: any) => ({ id: "claim-1", ...data }))
  tx.expenseCategory.findUnique.mockResolvedValue({ id: validClaim.categoryId, code: "TRAVEL", name: "Travel" })
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("createClaim", () => {
  it("400s a future spend date", async () => {
    await expect(
      createClaim(actor(), { ...validClaim, expenseDate: "2026-09-01" })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("400s an expense 91 days old", async () => {
    // 2026-05-16 is 91 days before 2026-08-15.
    await expect(
      createClaim(actor(), { ...validClaim, expenseDate: "2026-05-16" })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("accepts one exactly 90 days old", async () => {
    await expect(
      createClaim(actor(), { ...validClaim, expenseDate: "2026-05-17" })
    ).resolves.toBeTruthy()
  })

  it("accepts today", async () => {
    await expect(
      createClaim(actor(), { ...validClaim, expenseDate: "2026-08-15" })
    ).resolves.toBeTruthy()
  })

  it("creates PENDING with no frozen rate yet", async () => {
    const claim = await createClaim(actor(), validClaim)
    // The rate is frozen at approval, not at submission — an unapproved
    // claim has no agreed value.
    expect(claim).not.toHaveProperty("fxRateToBdt")
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entity: "EXPENSE_CLAIM", action: "CREATE" }) })
    )
  })
})

describe("approveClaim", () => {
  it("404s an unknown claim", async () => {
    vi.mocked(prisma.expenseClaim.findUnique).mockResolvedValue(null)
    await expect(approveClaim("nope", "fin-1", {})).rejects.toMatchObject({ statusCode: 404 })
  })

  it("409s a claim that is not PENDING", async () => {
    vi.mocked(prisma.expenseClaim.findUnique).mockResolvedValue({
      id: "claim-1",
      status: "APPROVED",
      currency: "BDT",
      expenseDate: new Date("2026-08-03T00:00:00.000Z"),
    } as never)
    await expect(approveClaim("claim-1", "fin-1", {})).rejects.toMatchObject({ statusCode: 409 })
  })

  it("freezes the spend-date rate, not the current one", async () => {
    // Spent 3 July, approved 15 August. Both rates exist; the July one wins,
    // because what someone is owed for a 3 July outlay is its 3 July value.
    vi.mocked(prisma.expenseClaim.findUnique).mockResolvedValue({
      id: "claim-1",
      status: "PENDING",
      currency: "USD",
      expenseDate: new Date("2026-07-03T00:00:00.000Z"),
      // The decision now emits an event naming the claim, so the fixture
      // carries the fields that line reads.
      employeeId: "emp-1",
      category: "Travel",
      amount: dec(80),
    } as never)
    vi.mocked(prisma.exchangeRate.findMany).mockResolvedValue([julyRate, augustRate] as never)

    await approveClaim("claim-1", "fin-1", {})
    const data = tx.expenseClaim.update.mock.calls[0][0].data
    expect(data.fxRateToBdt.toFixed(1)).toBe("122.0")
    expect(data.fxRateToBdt.toFixed(1)).not.toBe("122.5")
  })

  it("409s when no rate covers the spend date", async () => {
    vi.mocked(prisma.expenseClaim.findUnique).mockResolvedValue({
      id: "claim-1",
      status: "PENDING",
      currency: "USD",
      expenseDate: new Date("2026-06-03T00:00:00.000Z"),
    } as never)
    vi.mocked(prisma.exchangeRate.findMany).mockResolvedValue([])
    await expect(approveClaim("claim-1", "fin-1", {})).rejects.toMatchObject({ statusCode: 409 })
  })

  it("uses a rate of exactly 1 for a BDT claim, with no rate lookup", async () => {
    vi.mocked(prisma.expenseClaim.findUnique).mockResolvedValue({
      id: "claim-1",
      status: "PENDING",
      currency: "BDT",
      expenseDate: new Date("2026-08-03T00:00:00.000Z"),
      employeeId: "emp-1",
      category: "Travel",
      amount: dec(1200),
    } as never)
    await approveClaim("claim-1", "fin-1", {})
    expect(prisma.exchangeRate.findMany).not.toHaveBeenCalled()
    expect(tx.expenseClaim.update.mock.calls[0][0].data.fxRateToBdt.toFixed(6)).toBe("1.000000")
  })

  it("emails the claimant, naming the claim the way the expenses table does", async () => {
    vi.mocked(prisma.expenseClaim.findUnique).mockResolvedValue({
      id: "claim-1",
      status: "PENDING",
      currency: "BDT",
      expenseDate: new Date("2026-08-03T00:00:00.000Z"),
      employeeId: "emp-1",
      amount: dec(1200),
      employee: { user: { email: "claimant@b.com" } },
      category: { name: "Travel" },
    } as never)

    await approveClaim("claim-1", "fin-1", {})

    expect(sendExpenseDecidedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "claimant@b.com",
        approved: true,
        claimRef: "Travel on 2026-08-03",
      })
    )
  })
})

describe("rejectClaim", () => {
  it("409s a claim that is not PENDING", async () => {
    vi.mocked(prisma.expenseClaim.findUnique).mockResolvedValue({
      id: "claim-1",
      status: "REJECTED",
    } as never)
    await expect(rejectClaim("claim-1", "fin-1", { note: "Not reimbursable" })).rejects.toMatchObject({
      statusCode: 409,
    })
  })

  it("records the note", async () => {
    vi.mocked(prisma.expenseClaim.findUnique).mockResolvedValue({
      id: "claim-1",
      status: "PENDING",
      currency: "BDT",
      employeeId: "emp-1",
      category: "Travel",
      amount: dec(1200),
    } as never)
    await rejectClaim("claim-1", "fin-1", { note: "No receipt attached" })
    expect(tx.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "expense.rejected", severity: "WARNING" }),
      })
    )
    expect(tx.expenseClaim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "REJECTED", reviewNote: "No receipt attached" }),
      })
    )
  })

  it("emails the claimant the reason", async () => {
    vi.mocked(prisma.expenseClaim.findUnique).mockResolvedValue({
      id: "claim-1",
      status: "PENDING",
      currency: "BDT",
      expenseDate: new Date("2026-08-03T00:00:00.000Z"),
      employeeId: "emp-1",
      amount: dec(1200),
      employee: { user: { email: "claimant@b.com" } },
      category: { name: "Travel" },
    } as never)

    await rejectClaim("claim-1", "fin-1", { note: "No receipt attached" })

    expect(sendExpenseDecidedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "claimant@b.com",
        approved: false,
        reason: "No receipt attached",
      })
    )
  })
})

describe("claim events", () => {
  const emitted = () => tx.event.create.mock.calls[0][0].data

  it("emits expense.submitted at the subject, their manager and Finance", async () => {
    vi.mocked(requireEmployeeForUser).mockResolvedValue({ id: "emp-1" } as never)
    tx.expenseClaim.create.mockResolvedValue({
      id: "claim-9",
      employeeId: "emp-1",
      category: "Travel",
      amount: dec(1200),
      currency: "BDT",
    })
    tx.employee.findUnique.mockResolvedValue({ reportingManagerId: "emp-mgr" })

    await createClaim({ sub: "user-1" } as never, {
      amount: 1200,
      category: "Travel",
      currency: "BDT",
      expenseDate: "2026-08-03",
    } as never)

    expect(emitted()).toMatchObject({
      type: "expense.submitted",
      entity: "EXPENSE_CLAIM",
      entityId: "claim-9",
      subjectEmployeeId: "emp-1",
      managerEmployeeId: "emp-mgr",
      targetRoles: ["FINANCE_OFFICER"],
    })
  })

  it("carries the amount, unlike a payslip event", async () => {
    // A queue of "Travel claim submitted" lines with no figures is a queue
    // nobody can triage. Salary is a different kind of secret from a fare.
    vi.mocked(prisma.expenseClaim.findUnique).mockResolvedValue({
      id: "claim-1",
      status: "PENDING",
      currency: "BDT",
      employeeId: "emp-1",
      category: "Travel",
      amount: dec(1200),
      expenseDate: new Date("2026-08-03T00:00:00.000Z"),
    } as never)

    await approveClaim("claim-1", "fin-1", {})
    expect(emitted().meta).toContain("BDT 1200.00")
    expect(emitted().severity).toBe("SUCCESS")
  })

  it("writes no event when the transaction rolls back", async () => {
    vi.mocked(prisma.expenseClaim.findUnique).mockResolvedValue({
      id: "claim-1",
      status: "PENDING",
      currency: "BDT",
      employeeId: "emp-1",
      category: "Travel",
      amount: dec(1200),
      expenseDate: new Date("2026-08-03T00:00:00.000Z"),
    } as never)
    tx.expenseClaim.update.mockRejectedValueOnce(new Error("db down"))

    await expect(approveClaim("claim-1", "fin-1", {})).rejects.toThrow("db down")
    expect(tx.event.create).not.toHaveBeenCalled()
  })
})
