import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => {
  const tx = {
    payrollSetting: { findUnique: vi.fn(), upsert: vi.fn() },
    auditLog: { create: vi.fn() },
  }
  return {
    default: {
      payrollSetting: tx.payrollSetting,
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  }
})

import prisma from "../../config/prisma"
import { getPayrollSettings, updatePayrollSettings } from "./payroll.settings"
import { payrollSettingsBody } from "./payroll.validators"

const tx = (prisma as unknown as { __tx: { payrollSetting: { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> }; auditLog: { create: ReturnType<typeof vi.fn> } } }).__tx

beforeEach(() => {
  vi.clearAllMocks()
  tx.payrollSetting.findUnique.mockResolvedValue(null)
})

describe("getPayrollSettings", () => {
  it("returns today's rule (deduct) when nothing was ever saved", async () => {
    await expect(getPayrollSettings()).resolves.toEqual({ deductLossOfPay: true, recoverAssetsFromSalary: true })
  })

  it("returns what was saved", async () => {
    tx.payrollSetting.findUnique.mockResolvedValue({ id: "payroll", deductLossOfPay: false, recoverAssetsFromSalary: false })
    await expect(getPayrollSettings()).resolves.toEqual({ deductLossOfPay: false, recoverAssetsFromSalary: false })
  })
})

describe("updatePayrollSettings", () => {
  it("saves the switch, records who changed it and audits before and after", async () => {
    tx.payrollSetting.upsert.mockResolvedValue({ id: "payroll", deductLossOfPay: false, recoverAssetsFromSalary: true })

    const saved = await updatePayrollSettings("user-1", { deductLossOfPay: false })

    expect(saved).toEqual({ deductLossOfPay: false, recoverAssetsFromSalary: true })
    expect(tx.payrollSetting.upsert).toHaveBeenCalledWith({
      where: { id: "payroll" },
      update: { deductLossOfPay: false, recoverAssetsFromSalary: true, updatedBy: "user-1" },
      create: { id: "payroll", deductLossOfPay: false, recoverAssetsFromSalary: true, updatedBy: "user-1" },
    })
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entity: "PAYROLL_SETTING",
        action: "UPDATE",
        changedBy: "user-1",
        before: { deductLossOfPay: true, recoverAssetsFromSalary: true },
        after: { deductLossOfPay: false, recoverAssetsFromSalary: true },
      }),
    })
  })

  it("keeps the saved value of a switch that was not sent", async () => {
    tx.payrollSetting.findUnique.mockResolvedValue({ id: "payroll", deductLossOfPay: false, recoverAssetsFromSalary: true })
    tx.payrollSetting.upsert.mockResolvedValue({ id: "payroll", deductLossOfPay: false, recoverAssetsFromSalary: false })

    await updatePayrollSettings("user-1", { recoverAssetsFromSalary: false })

    expect(tx.payrollSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { deductLossOfPay: false, recoverAssetsFromSalary: false, updatedBy: "user-1" },
      })
    )
  })
})

describe("payrollSettingsBody", () => {
  it("accepts a boolean and refuses anything else", () => {
    expect(payrollSettingsBody.safeParse({ deductLossOfPay: false }).success).toBe(true)
    expect(payrollSettingsBody.safeParse({ deductLossOfPay: "no" }).success).toBe(false)
    expect(payrollSettingsBody.safeParse({}).success).toBe(false)
    expect(payrollSettingsBody.safeParse({ recoverAssetsFromSalary: false }).success).toBe(true)
  })
})
