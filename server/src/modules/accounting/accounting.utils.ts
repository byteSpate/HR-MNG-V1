/**
 * Pure functions for the ledger. No Prisma, no I/O, no clock — everything
 * here is a value in and a value out, which is why the tests need no mocks.
 *
 * The arithmetic risk in this module is not the queries; it is here. Every
 * amount is a `Prisma.Decimal`. A single `+` on a JS number is how a trial
 * balance ends up a paisa out with nobody able to say which line did it.
 */

import { Prisma } from "../../generated/prisma/client"
import type { AccountType } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { shownSides } from "./accounting.sideStyle"

export type Side = "DEBIT" | "CREDIT"

export interface AmountPair {
  debit: Prisma.Decimal
  credit: Prisma.Decimal
}

const ZERO = new Prisma.Decimal(0)

/** Grouping to two decimals, the way the statements print: 5,20,000.00. */
export function formatBdt(value: Prisma.Decimal): string {
  return Number(value.toFixed(2)).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function sumSides(lines: AmountPair[]): AmountPair {
  return lines.reduce<AmountPair>(
    (acc, l) => ({ debit: acc.debit.plus(l.debit), credit: acc.credit.plus(l.credit) }),
    { debit: ZERO, credit: ZERO }
  )
}

/**
 * The line-level shape rule: exactly one side, positive. Reported with a
 * 1-based row number because that is what the person is looking at.
 */
export function assertLineShape(line: AmountPair, index: number): void {
  const row = index + 1
  if (line.debit.isNegative() || line.credit.isNegative()) {
    throw new AppError(400, `Line ${row}: an amount cannot be negative`)
  }
  const hasDebit = line.debit.greaterThan(0)
  const hasCredit = line.credit.greaterThan(0)
  if (hasDebit && hasCredit) {
    throw new AppError(400, `Line ${row}: a line carries either a debit or a credit, not both`)
  }
  if (!hasDebit && !hasCredit) {
    throw new AppError(400, `Line ${row}: enter a debit or a credit`)
  }
}

/**
 * The journal-level rule. The message carries both totals deliberately —
 * "Debit 5,20,000.00 does not equal credit 5,00,000.00" is diagnosable;
 * "Journal is unbalanced" is not.
 */
export function assertBalanced(lines: AmountPair[]): void {
  if (lines.length < 2) {
    throw new AppError(400, "A journal needs at least two lines")
  }

  const { debit, credit } = sumSides(lines)
  // Checked before the line shapes so an all-zero journal reports the
  // total rule, not a per-line "enter a debit or a credit".
  if (debit.isZero() && credit.isZero()) {
    throw new AppError(400, "A journal total must be greater than zero")
  }

  lines.forEach(assertLineShape)

  if (!debit.equals(credit)) {
    // Said the way the screens say it, so the two figures sit under the same
    // names the person sees (see accounting.sideStyle.ts).
    const shown = shownSides(debit, credit)
    throw new AppError(
      400,
      `Debit ${formatBdt(shown.debit)} does not equal credit ${formatBdt(shown.credit)}`
    )
  }
}

const TYPE_PREFIX: Record<AccountType, string> = {
  ASSET: "1",
  LIABILITY: "2",
  EQUITY: "3",
  INCOME: "4",
  EXPENSE: "5",
}

export function validateAccountCode(code: string, type: AccountType): void {
  if (!/^\d{4}$/.test(code)) {
    throw new AppError(400, `An account code is exactly four digits; got "${code}"`)
  }
  const expected = TYPE_PREFIX[type]
  if (code[0] !== expected) {
    throw new AppError(
      400,
      `A ${type} account's code must start with ${expected}; "${code}" starts with ${code[0]}`
    )
  }
}

const CREDIT_TYPES: AccountType[] = ["LIABILITY", "EQUITY", "INCOME"]

export function normalSide(type: AccountType): Side {
  return CREDIT_TYPES.includes(type) ? "CREDIT" : "DEBIT"
}

/**
 * The balance as an accountant reads it: positive when the account sits on
 * its normal side. A negative result is meaningful, not an error — an
 * accumulated-depreciation account is an ASSET that normally carries a
 * credit, and a loss-making year's Retained Earnings is negative equity.
 */
export function signedBalance(
  type: AccountType,
  debit: Prisma.Decimal,
  credit: Prisma.Decimal
): Prisma.Decimal {
  return normalSide(type) === "DEBIT" ? debit.minus(credit) : credit.minus(debit)
}

export function invertLines<T extends AmountPair>(lines: T[]): T[] {
  return lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }))
}

/** UTC midnight, the date-only convention leave and attendance already use. */
export function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

/**
 * Truncate an instant to the UTC day it falls in.
 *
 * Every accounting date is a date, not a moment. Periods run from UTC midnight
 * to UTC midnight, so an instant carrying a time of day sits *past* the end of
 * the last day of its own month: 31 July at 10:00 is greater than the July
 * period's endDate of 31 July at 00:00, and `resolveOpenPeriod` answers "no
 * financial year covers 2026-07-31" for a perfectly valid date. Callers that
 * hold a real timestamp — a payroll run's, a disbursement's — pass it through
 * here rather than each remembering to zero the clock.
 */
export function toLedgerDate(value: Date): Date {
  return utcDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate())
}

export function monthWindow(year: number, month: number): { startDate: Date; endDate: Date } {
  // Day 0 of the following month is the last day of this one, which handles
  // 28/29/30/31 without a lookup table.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { startDate: utcDate(year, month, 1), endDate: utcDate(year, month, lastDay) }
}

export function financialYearPeriods(
  startDate: Date
): Array<{ year: number; month: number; startDate: Date; endDate: Date }> {
  const firstYear = startDate.getUTCFullYear()
  const firstMonth = startDate.getUTCMonth() + 1

  return Array.from({ length: 12 }, (_, i) => {
    const absolute = firstMonth - 1 + i
    const year = firstYear + Math.floor(absolute / 12)
    const month = (absolute % 12) + 1
    return { year, month, ...monthWindow(year, month) }
  })
}

/**
 * "FY 2026-27" for a July start, "FY 2026" for a January one. The two-digit
 * suffix is taken modulo 100 so a century boundary produces "FY 2099-00"
 * rather than "FY 2099-100".
 */
export function financialYearName(startDate: Date): string {
  const year = startDate.getUTCFullYear()
  if (startDate.getUTCMonth() === 0) return `FY ${year}`
  return `FY ${year}-${String((year + 1) % 100).padStart(2, "0")}`
}
