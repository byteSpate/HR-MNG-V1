/**
 * Shared payroll interfaces.
 *
 * Every money field in a `breakdown` is a **string**, not a number. `Decimal`
 * serialises via `toJSON` as a string already, but at full precision — so an
 * unrounded value would land in the Json column with more decimals than every
 * other line beside it. Formatting through `toMoneyString` is what keeps the
 * stored document internally consistent, and it is why these are typed as
 * strings rather than as `Money`: the type stops a raw Decimal being written.
 */

import type { ComponentCalc, ComponentKind, Currency } from "../../generated/prisma/client"
import type { Money } from "./payroll.money"

/** How a `breakdown` line arrived at its amount. */
export type LineCalc = ComponentCalc | "ADJUSTMENT"

export interface PayslipLine {
  code: string
  label: string
  calc: LineCalc
  /** The percentage or fixed amount as configured, not the resolved figure. */
  value: string
  /** The resolved figure, in the payslip's currency. */
  amount: string
  /** Present only on adjustment lines. */
  kind?: ComponentKind
}

export interface ReimbursementLine {
  claimId: string
  category: string
  expenseDate: string
  /** What the money was actually spent in. */
  spentCurrency: Currency
  spentAmount: string
  /** The claim's own spend-date rate, frozen at approval — not the run's. */
  fxRateToBdt: string
  /** The figure in the payslip's currency. */
  amount: string
}

/**
 * The attendance inputs, frozen into the document.
 *
 * Embedded rather than looked up later because the day grid is *derived*: a
 * holiday edited in November changes what August's summary would say today.
 * Freezing the inputs is what makes a paid payslip reproducible.
 */
export interface PayslipAttendance {
  calendarDays: number
  workingDays: number
  present: number
  absent: number
  onPaidLeave: number
  onUnpaidLeave: number
  lopDays: number
  payableDays: number
}

export interface PayslipBreakdown {
  currency: Currency
  fxRateToBdt: string
  /** Basic first, then components by sortOrder. */
  earnings: PayslipLine[]
  deductions: PayslipLine[]
  adjustments: PayslipLine[]
  reimbursements: ReimbursementLine[]
  attendance: PayslipAttendance
}

/** A salary component as the calculation sees it, denomination-free. */
export interface ComponentInput {
  code: string
  label: string
  kind: ComponentKind
  calc: ComponentCalc
  value: Money
  sortOrder: number
}

/**
 * An adjustment **already converted into the payment currency** by the caller.
 *
 * The conversion happens outside because an adjustment may be entered in a
 * different currency from the one the employee is paid in — HR thinks in BDT.
 * Converting it here would mean this function knew about currencies, and
 * converting it *after* the sum would make the payslip's own lines disagree
 * with its total.
 */
export interface AdjustmentInput {
  code: string
  label: string
  kind: ComponentKind
  amount: Money
}

/** A swept expense claim, already converted at its own spend-date rate. */
export interface ReimbursementInput {
  claimId: string
  category: string
  expenseDate: string
  spentCurrency: Currency
  spentAmount: Money
  fxRateToBdt: Money
  /** In the payment currency. Converted once, at approval, and never again. */
  amount: Money
}

/**
 * Everything `computePayslip` needs. No currency and no employee — one
 * employee has exactly one payment currency, so no payslip ever needs
 * mixed-currency addition.
 */
export interface PayslipInput {
  basic: Money
  components: ComponentInput[]
  adjustments: AdjustmentInput[]
  reimbursements: ReimbursementInput[]
  calendarDays: number
  /** Reported on the document; the denominator is calendarDays, not this. */
  workingDays: number
  present: number
  absent: number
  onPaidLeave: number
  /** The only leave that costs money. */
  onUnpaidLeave: number
  /**
   * When false, absent days and unpaid leave are recorded on the payslip but
   * do not lower pay. Left out means true, so every existing caller keeps the
   * rule it always had.
   */
  deductLossOfPay?: boolean
}

export interface PayslipResult {
  calendarDays: number
  lopDays: Money
  payableDays: Money
  basic: Money
  /** Earnings at a full month, before any pro-ration. */
  grossFull: Money
  /** Pro-rated earnings plus earning adjustments. */
  grossPay: Money
  totalDeductions: Money
  /** May be negative. The caller rejects it rather than this clamping it. */
  netPay: Money
  reimbursements: Money
  netPayable: Money
  /**
   * Every line, in document order. Money is already formatted to 2dp strings,
   * so what is stored is exactly what was computed.
   */
  breakdown: Omit<PayslipBreakdown, "currency" | "fxRateToBdt">
}
