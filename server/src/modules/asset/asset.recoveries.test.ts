import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => {
  const tx = {
    assetRecovery: { create: vi.fn(), update: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    asset: { findUnique: vi.fn() },
    assetAssignment: { findFirst: vi.fn(), findMany: vi.fn() },
    payrollAdjustment: { create: vi.fn() },
    payrollSetting: { findUnique: vi.fn(async () => null) },
    employee: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  }
  return {
    default: {
      assetRecovery: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  }
})

import prisma from "../../config/prisma"
import {
  createRecovery,
  listRecoveries,
  pendingRecoveriesFor,
  recoverFromPayroll,
  updateRecovery,
  waiveRecovery,
} from "./asset.recoveries"

const tx = (prisma as unknown as { __tx: any }).__tx

const hr = { sub: "user-hr", role: "HR_ADMIN", email: "hr@demo.com", mustChangePassword: false } as never
const finance = { sub: "user-fin", role: "FINANCE_OFFICER", email: "f@demo.com", mustChangePassword: false } as never

const laptop = {
  id: "a-1", assetTag: "BS-AST-00001", name: "ThinkPad T14",
  category: { code: "LAPTOP", name: "Laptop" },
}

beforeEach(() => {
  vi.clearAllMocks()
  tx.assetRecovery.create.mockResolvedValue({ id: "rec-1", status: "PENDING" })
  tx.assetRecovery.update.mockResolvedValue({ id: "rec-1" })
  tx.assetRecovery.findUnique.mockResolvedValue({
    id: "rec-1", status: "PENDING", employeeId: "emp-1", assetId: "a-1",
    amount: "45000.00", currency: "BDT", kind: "NOT_RETURNED",
    adjustment: null, settlement: null, payslip: null,
  })
  tx.assetRecovery.findFirst.mockResolvedValue(null)
  tx.asset.findUnique.mockResolvedValue(laptop)
  tx.assetAssignment.findFirst.mockResolvedValue(null)
  tx.assetAssignment.findMany.mockResolvedValue([])
  tx.auditLog.create.mockResolvedValue({})
})

describe("createRecovery", () => {
  it("requires a non-empty reason", async () => {
    await expect(
      createRecovery(
        { assetId: "a-1", employeeId: "emp-1", amount: "45000", reason: "  " },
        hr
      )
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(tx.assetRecovery.create).not.toHaveBeenCalled()
  })

  it("refuses a zero or negative amount, saying a zero-value recovery is a waiver", async () => {
    await expect(
      createRecovery(
        { assetId: "a-1", employeeId: "emp-1", amount: "0", reason: "Laptop not returned" },
        hr
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/waiv/i),
    })
  })

  it("refuses an asset the employee has no assignment history with", async () => {
    tx.assetAssignment.findFirst.mockResolvedValue(null)

    await expect(
      createRecovery(
        { assetId: "a-1", employeeId: "emp-1", amount: "45000", reason: "Laptop not returned" },
        hr
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("BS-AST-00001"),
    })
  })

  it("records who typed the figure", async () => {
    tx.assetAssignment.findFirst.mockResolvedValue({ id: "asg-1", assetId: "a-1", employeeId: "emp-1" })

    await createRecovery(
      { assetId: "a-1", employeeId: "emp-1", amount: "45000", reason: "Laptop not returned" },
      hr
    )

    expect(tx.assetRecovery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ createdBy: "user-hr", status: "PENDING" }),
      })
    )
  })

  it("writes a CREATE audit row in the same transaction", async () => {
    tx.assetAssignment.findFirst.mockResolvedValue({ id: "asg-1", assetId: "a-1", employeeId: "emp-1" })

    await createRecovery(
      { assetId: "a-1", employeeId: "emp-1", amount: "45000", reason: "Laptop not returned" },
      hr
    )

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entity: "ASSET_RECOVERY",
        action: "CREATE",
        changedBy: "user-hr",
      }),
    })
  })
})

describe("updateRecovery", () => {
  it("allows corrections while PENDING", async () => {
    tx.assetRecovery.findUnique.mockResolvedValue({
      id: "rec-1", status: "PENDING", employeeId: "emp-1", assetId: "a-1",
    })

    await updateRecovery("rec-1", { amount: "50000", reason: "Including the charger" }, hr)

    expect(tx.assetRecovery.update).toHaveBeenCalled()
  })

  it("refuses an edit once RECOVERED, naming what collected it", async () => {
    tx.assetRecovery.findUnique.mockResolvedValue({
      id: "rec-1", status: "RECOVERED", employeeId: "emp-1", assetId: "a-1",
      adjustment: { payslip: { payslipNo: "BS-PAY-000001" } },
      settlement: null,
    })

    await expect(
      updateRecovery("rec-1", { amount: "50000" }, hr)
    ).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe("waiveRecovery", () => {
  it("requires a waiver reason", async () => {
    await expect(
      waiveRecovery("rec-1", { waiverReason: "" }, hr)
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("keeps the row and records who waived it and why", async () => {
    tx.assetRecovery.findUnique.mockResolvedValue({
      id: "rec-1", status: "PENDING", employeeId: "emp-1", assetId: "a-1",
    })

    await waiveRecovery("rec-1", { waiverReason: "Company fault — it was water damage" }, hr)

    expect(tx.assetRecovery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "WAIVED", waivedBy: "user-hr" }),
      })
    )
  })

  it("refuses to waive something already RECOVERED, naming the payslip", async () => {
    tx.assetRecovery.findUnique.mockResolvedValue({
      id: "rec-1", status: "RECOVERED", employeeId: "emp-1", assetId: "a-1",
      adjustment: { payslip: { payslipNo: "BS-PAY-000001" } },
      settlement: null,
    })

    await expect(
      waiveRecovery("rec-1", { waiverReason: "Change of heart" }, hr)
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("BS-PAY-000001"),
    })
  })

  it("refuses to un-waive", async () => {
    tx.assetRecovery.findUnique.mockResolvedValue({
      id: "rec-1", status: "WAIVED", employeeId: "emp-1", assetId: "a-1",
      waivedBy: "user-hr", waiverReason: "Company fault",
    })

    await expect(
      waiveRecovery("rec-1", { waiverReason: "Actually, charge her" }, hr)
    ).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe("listRecoveries", () => {
  it("passes the filters straight through to the query", async () => {
    tx.assetRecovery.findMany.mockResolvedValue([])
    await listRecoveries({ employeeId: "emp-1", status: "PENDING" }, hr as never)
    expect(tx.assetRecovery.findMany).toHaveBeenCalled()
  })

  it("scopes an employee read to their own recoveries", async () => {
    const staff = { sub: "user-1", role: "EMPLOYEE", email: "e@demo.com", mustChangePassword: false } as never
    tx.employee.findUnique.mockResolvedValue({ id: "emp-9" })
    tx.assetRecovery.findMany.mockResolvedValue([])

    await listRecoveries({}, staff)

    expect(tx.assetRecovery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ employeeId: "emp-9" }) })
    )
  })
})

describe("pendingRecoveriesFor", () => {
  it("lists only PENDING recoveries for the employee", async () => {
    tx.assetRecovery.findMany.mockResolvedValue([])
    await pendingRecoveriesFor("emp-1", tx)
    expect(tx.assetRecovery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ employeeId: "emp-1", status: "PENDING" }) })
    )
  })
})

describe("recoverFromPayroll", () => {
  beforeEach(() => {
    tx.assetRecovery.findUnique.mockResolvedValue({
      id: "rec-1", status: "PENDING", employeeId: "emp-1", assetId: "a-1",
      amount: "45000.00", currency: "BDT", kind: "NOT_RETURNED", reason: "Laptop not returned",
      adjustment: null, settlement: null, asset: { assetTag: "BS-AST-00001", name: "ThinkPad T14" },
    })
    tx.payrollAdjustment.create.mockResolvedValue({ id: "adj-1" })
    tx.assetRecovery.update.mockResolvedValue({ id: "rec-1", adjustmentId: "adj-1", status: "PENDING" })
  })

  it("refuses, and creates nothing, when the company does not take assets from salary", async () => {
    tx.payrollSetting.findUnique.mockResolvedValueOnce({ id: "payroll", deductLossOfPay: true, recoverAssetsFromSalary: false })

    await expect(recoverFromPayroll("rec-1", hr)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("turned off"),
    })
    expect(tx.payrollAdjustment.create).not.toHaveBeenCalled()
  })

  it("creates a DEDUCTION adjustment carrying the recovery's amount, currency and reason", async () => {
    await recoverFromPayroll("rec-1", hr)

    expect(tx.payrollAdjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          employeeId: "emp-1",
          kind: "DEDUCTION",
          code: "ASSET_RECOVERY",
          amount: "45000.00",
          currency: "BDT",
          reason: "Laptop not returned",
        }),
      })
    )
  })

  /** The @unique on adjustmentId is the guard, not a service check that
   *  could be raced by two clicks. */
  it("refuses a second call, naming the existing adjustment", async () => {
    tx.payrollAdjustment.create.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint"), { code: "P2002" })
    )

    await expect(recoverFromPayroll("rec-1", hr)).rejects.toMatchObject({ statusCode: 409 })
  })

  it("refuses a WAIVED recovery", async () => {
    tx.assetRecovery.findUnique.mockResolvedValue({
      id: "rec-1", status: "WAIVED", employeeId: "emp-1", assetId: "a-1",
      adjustment: null, settlement: null,
    })

    await expect(recoverFromPayroll("rec-1", hr)).rejects.toMatchObject({ statusCode: 409 })
    expect(tx.payrollAdjustment.create).not.toHaveBeenCalled()
  })

  it("refuses a RECOVERED recovery", async () => {
    tx.assetRecovery.findUnique.mockResolvedValue({
      id: "rec-1", status: "RECOVERED", employeeId: "emp-1", assetId: "a-1",
      adjustment: { payslip: { payslipNo: "BS-PAY-000001" } }, settlement: null,
    })

    await expect(recoverFromPayroll("rec-1", hr)).rejects.toMatchObject({ statusCode: 409 })
    expect(tx.payrollAdjustment.create).not.toHaveBeenCalled()
  })

  it("links the adjustment back onto the recovery", async () => {
    await recoverFromPayroll("rec-1", hr)

    expect(tx.assetRecovery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-1" },
        data: expect.objectContaining({ adjustmentId: "adj-1" }),
      })
    )
  })

  it("leaves the recovery PENDING — the sweep flips it, not this", async () => {
    await recoverFromPayroll("rec-1", hr)

    const update = (tx.assetRecovery.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(update.data.status).toBeUndefined()
  })
})
