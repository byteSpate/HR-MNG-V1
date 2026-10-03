/**
 * The payroll month lock.
 *
 * A month with an APPROVED or DISBURSED PayrollRun is closed. Anything that
 * would change what that month's payroll *should* have paid must refuse,
 * because the money has already been decided — and in the DISBURSED case,
 * already left the building.
 *
 * Lives in `src/utils` rather than in the payroll module because leave and
 * attendance both call it. Leave importing from
 * `../attendance/attendance.holidays` for a payroll rule would be the wrong
 * dependency in two directions at once.
 *
 * Four call sites: holiday writes and leave approval (both wired here),
 * payroll adjustments, and exit-detail edits (each wired with the code that
 * needs them).
 */

import prisma from "../config/prisma"
import { AppError } from "../middleware/errorHandler"

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const

/**
 * DRAFT and SUBMITTED deliberately pass. Neither has paid anybody yet, and a
 * run still being worked is *expected* to be reprocessed — `process` is an
 * idempotent rebuild precisely so a late correction can be absorbed. Locking
 * at SUBMITTED would mean a rejected run could never have its cause fixed.
 */
const LOCKED_STATUSES = ["APPROVED", "DISBURSED"] as const

export function monthName(date: Date): string {
  return MONTH_NAMES[date.getUTCMonth()]
}

/**
 * Throws 409 when `date` falls in a month whose payroll is already approved
 * or disbursed. Reads the date in UTC, matching the date-only convention
 * every module stores calendar dates in.
 */
export async function assertMonthNotLocked(date: Date): Promise<void> {
  const month = date.getUTCMonth() + 1
  const year = date.getUTCFullYear()

  const run = await prisma.payrollRun.findUnique({
    // The live run for the month; a deleted run has no key.
    where: { activeKey: `${year}-${String(month).padStart(2, "0")}` },
    select: { status: true },
  })

  if (run && (LOCKED_STATUSES as readonly string[]).includes(run.status)) {
    throw new AppError(
      409,
      `${monthName(date)} ${year} payroll is already ${run.status.toLowerCase()}. ` +
        `Changes to that month would make money already paid incorrect.`
    )
  }
}
