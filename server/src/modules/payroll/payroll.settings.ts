/**
 * Company-wide payroll rules an administrator can switch.
 *
 * One row, keyed "payroll". A database with no row gets the defaults below,
 * which are the rules payroll had before this table existed — so nothing
 * changes for anyone until somebody saves a setting.
 */

import prisma from "../../config/prisma"
import type { Prisma } from "../../generated/prisma/client"
import { writeAudit } from "../../utils/audit"
import type { PayrollSettingsBody } from "./payroll.validators"

const SETTINGS_ID = "payroll"

export interface PayrollSettings {
  /** False means absent days and unpaid leave never lower pay. */
  deductLossOfPay: boolean
  /** False means a lost or damaged asset is never taken from salary. */
  recoverAssetsFromSalary: boolean
}

export const DEFAULT_PAYROLL_SETTINGS: PayrollSettings = {
  deductLossOfPay: true,
  recoverAssetsFromSalary: true,
}

/** Takes a client or a transaction, so a run reads it inside its own transaction. */
export async function loadPayrollSettings(
  db: Pick<Prisma.TransactionClient, "payrollSetting">
): Promise<PayrollSettings> {
  const row = await db.payrollSetting.findUnique({ where: { id: SETTINGS_ID } })
  return row
    ? {
        deductLossOfPay: row.deductLossOfPay,
        recoverAssetsFromSalary: row.recoverAssetsFromSalary,
      }
    : DEFAULT_PAYROLL_SETTINGS
}

export async function getPayrollSettings(): Promise<PayrollSettings> {
  return loadPayrollSettings(prisma)
}

export async function updatePayrollSettings(
  actorUserId: string,
  body: PayrollSettingsBody
): Promise<PayrollSettings> {
  return prisma.$transaction(async (tx) => {
    const before = await loadPayrollSettings(tx)
    // A field left out keeps its saved value, so one switch can be saved alone.
    const next = { ...before, ...body }
    const saved = await tx.payrollSetting.upsert({
      where: { id: SETTINGS_ID },
      update: { ...next, updatedBy: actorUserId },
      create: { id: SETTINGS_ID, ...next, updatedBy: actorUserId },
    })
    await writeAudit(tx, {
      entity: "PAYROLL_SETTING",
      entityId: SETTINGS_ID,
      action: "UPDATE",
      changedBy: actorUserId,
      before: { ...before },
      after: {
        deductLossOfPay: saved.deductLossOfPay,
        recoverAssetsFromSalary: saved.recoverAssetsFromSalary,
      },
    })
    return {
      deductLossOfPay: saved.deductLossOfPay,
      recoverAssetsFromSalary: saved.recoverAssetsFromSalary,
    }
  })
}
