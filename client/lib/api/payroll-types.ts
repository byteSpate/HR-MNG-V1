/**
 * Payroll, expense and settlement types, hand-mirrored from the server.
 *
 * There is no shared validation package between client and server; this
 * duplication is deliberate and pre-existing.
 *
 * **Every money field is a `string`.** A `number` here would be a float
 * again, reintroducing exactly what `Decimal` exists to avoid on the server.
 * The client formats these and never does arithmetic on them.
 *
 * Kept beside `types.ts` rather than inside it: that file is the auth /
 * employee / leave / attendance surface, and this is a self-contained new
 * one. Both are re-exported from `types.ts`, so importers see one module.
 */

export type Currency = "BDT" | "USD"
export type ComponentKind = "EARNING" | "DEDUCTION"
export type ComponentCalc = "FIXED" | "PERCENT_OF_BASIC"
export type PayrollStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "DISBURSED"
export type SettlementStatus = "DRAFT" | "APPROVED" | "PAID"
export type ExpenseStatus = "PENDING" | "APPROVED" | "REJECTED" | "REIMBURSED"
export type ExitReason =
  | "RESIGNATION"
  | "RETIREMENT"
  | "TERMINATION"
  | "DISMISSAL"
  | "DISCHARGE"
  | "RETRENCHMENT"
  | "CONTRACT_END"
  | "DEATH"

export interface SalaryComponent {
  id: string
  code: string
  label: string
  kind: ComponentKind
  calc: ComponentCalc
  value: string
  sortOrder: number
  countsAsWages: boolean
}

export interface SalaryStructure {
  id: string
  name: string
  currency: Currency
  basic: string
  isActive: boolean
  components: SalaryComponent[]
  /**
   * How many employees are assigned. The server refuses to delete a structure
   * in use, so this is what lets the control say so before it is pressed.
   */
  employeeCount: number
}

export interface SalaryStructureInput {
  name: string
  currency: Currency
  basic: number
  isActive?: boolean
  components: Array<{
    code: string
    label: string
    kind: ComponentKind
    calc: ComponentCalc
    value: number
    sortOrder?: number
    countsAsWages?: boolean
  }>
}

export interface ExchangeRate {
  id: string
  base: Currency
  quote: Currency
  rate: string
  effectiveFrom: string
  createdBy: string
  createdAt: string
}

export interface ExchangeRateInput {
  base: Currency
  quote: Currency
  rate: number
  effectiveFrom: string
}

export interface PayslipLine {
  code: string
  label: string
  calc: ComponentCalc | "ADJUSTMENT"
  value: string
  amount: string
  kind?: ComponentKind
}

export interface ReimbursementLine {
  claimId: string
  category: string
  expenseDate: string
  spentCurrency: Currency
  spentAmount: string
  fxRateToBdt: string
  amount: string
}

export interface PayslipBreakdown {
  currency: Currency
  fxRateToBdt: string
  earnings: PayslipLine[]
  deductions: PayslipLine[]
  adjustments: PayslipLine[]
  reimbursements: ReimbursementLine[]
  attendance: {
    calendarDays: number
    workingDays: number
    present: number
    absent: number
    onPaidLeave: number
    onUnpaidLeave: number
    lopDays: number
    payableDays: number
  }
}

export interface Payslip {
  id: string
  payslipNo: string
  payrollRunId: string
  employeeId: string
  calendarDays: number
  lopDays: string
  payableDays: string
  currency: Currency
  basic: string
  grossFull: string
  grossPay: string
  totalDeductions: string
  netPay: string
  reimbursements: string
  netPayable: string
  fxRateToBdt: string
  grossPayBdt: string
  totalDeductionsBdt: string
  netPayBdt: string
  netPayableBdt: string
  breakdown: PayslipBreakdown
  pdfUrl: string | null
  emailedAt: string | null
  emailError: string | null
  employee?: { id: string; fullName: string; employeeCode: string }
  payrollRun?: { id: string; month: number; year: number; status: PayrollStatus }
}

export interface PayrollRun {
  id: string
  month: number
  year: number
  status: PayrollStatus
  fxRateToBdt: string | null
  disbursementFxRateToBdt: string | null
  processedBy: string | null
  processedAt: string | null
  submittedBy: string | null
  submittedAt: string | null
  approvedBy: string | null
  approvedAt: string | null
  disbursedBy: string | null
  disbursedAt: string | null
  rejectionNote: string | null
  notes: string | null
  createdAt: string
  payslipCount?: number
  grossPayBdt?: string
  totalDeductionsBdt?: string
  netPayBdt?: string
  netPayableBdt?: string
  payslips?: Payslip[]
  preflight?: PreflightReport
  accounting?: { accrual: AccountingPeriodCheck; payment: AccountingPeriodCheck }
}

export interface AccountingPeriodCheck { date: string; label: string; status: "OPEN" | "CLOSED" | "LOCKED" | "MISSING"; ok: boolean }

export type PreflightBlockerCode =
  | "MONTH_NOT_OVER"
  | "UNAPPROVED_ATTENDANCE"
  | "MISSING_SALARY_STRUCTURE"
  | "MISSING_EXCHANGE_RATE"
  | "NEGATIVE_NET_PAY"

export interface PreflightBlocker {
  code: PreflightBlockerCode
  message: string
  employees: Array<{
    employeeId: string
    fullName: string
    employeeCode: string
    detail: string
  }>
}

export interface PreflightReport {
  month: number
  year: number
  ok: boolean
  blockers: PreflightBlocker[]
}

export interface PayrollAdjustment {
  id: string
  employeeId: string
  month: number
  year: number
  kind: ComponentKind
  code: string
  label: string
  currency: Currency
  amount: string
  reason: string
  createdBy: string
  createdAt: string
  payslipId: string | null
  employee?: { id: string; fullName: string; employeeCode: string }
}

export interface AdjustmentInput {
  employeeId: string
  month: number
  year: number
  kind: ComponentKind
  code: string
  label: string
  currency: Currency
  amount: number
  reason: string
}

export interface BankFileManifest {
  runId: string
  month: number
  year: number
  currency: Currency
  rows: number
  totalNative: string
  totalBdt: string
  excluded: Array<{ currency: Currency; rows: number }>
}

export interface BankFileSummary {
  runId: string
  month: number
  year: number
  payslipCount: number
  totalRows: number
  /** False means some payslip belongs to no file — somebody would not be paid. */
  complete: boolean
  currencies: Array<{ currency: Currency; rows: number; totalNative: string; totalBdt: string }>
}

export interface EmailStatus {
  total: number
  sent: number
  failed: number
  inProgress: boolean
}

export interface ExpenseClaim {
  id: string
  employeeId: string
  /** What it is — "Water jar". Null on claims filed before the field existed. */
  name: string | null
  /** Both null unless the category carries a route. */
  travelFrom: string | null
  travelTo: string | null
  amount: string
  categoryId: string
  category: { code: string; name: string }
  description: string | null
  receiptUrl: string | null
  status: ExpenseStatus
  expenseDate: string
  currency: Currency
  fxRateToBdt: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  reviewNote: string | null
  payslipId: string | null
  settlementId: string | null
  createdAt: string
  employee?: { id: string; fullName: string; employeeCode: string }
  payslip?: { id: string; payslipNo: string; payrollRunId: string } | null
}

export interface ExpenseCategory { id: string; code: string; name: string }

export interface ExpenseClaimInput {
  /** Required. A category alone cannot tell two claims apart. */
  name: string
  amount: number
  categoryId: string
  currency: Currency
  expenseDate: string
  description?: string
  receiptUrl?: string
  /** Only travel and conveyance claims carry a route; the server drops these
   *  for any other category rather than storing a journey that never happened. */
  travelFrom?: string
  travelTo?: string
}

/**
 * Category codes whose claims describe a journey. Mirrors
 * `ROUTE_CATEGORY_CODES` in `expense.service.ts` — the server drops From and
 * To for anything else, so a client offering them elsewhere would be
 * collecting text it knows will be thrown away.
 */
export const ROUTE_CATEGORY_CODES = ["TRAVEL", "CONVEYANCE"]

export interface ExpenseReceipt {
  id: string
  fileName: string
  bytes: number
  format: string
  uploadedAt: string
}

export interface ExpenseReportRow {
  id: string
  employee: { id: string; fullName: string; employeeCode: string }
  name: string | null
  category: { code: string; name: string }
  expenseDate: string
  amount: string
  currency: string
  status: ExpenseStatus
  description: string | null
  travelFrom: string | null
  travelTo: string | null
  /** Zero is the thing an approver looks for. */
  receipts: number
  paidOn: string | null
}

export interface ExpenseReport {
  from: string
  to: string
  /** Present only when the report was narrowed to one person. */
  employee: { id: string; fullName: string; employeeCode: string } | null
  status: ExpenseStatus | null
  rows: ExpenseReportRow[]
  totals: {
    claims: number
    /** Per currency, never added together — see `expense.report.ts`. */
    byCurrency: { currency: Currency; claims: number; amount: string }[]
    /** Counts per status, and the money behind each — also split by currency. */
    byStatus: {
      status: ExpenseStatus
      claims: number
      byCurrency: { currency: Currency; amount: string }[]
    }[]
  }
}

export interface OutstandingExpenseReimbursementRow {
  id: string
  employee: { id: string; fullName: string; employeeCode: string }
  name: string | null
  category: { code: string; name: string }
  approvedAt: string | null
  ageDays: number | null
  amount: string
  currency: Currency
}

export interface OutstandingExpenseReimbursements {
  rows: OutstandingExpenseReimbursementRow[]
  totals: {
    claims: number
    /** Per currency; different currencies are never added together. */
    byCurrency: { currency: Currency; claims: number; amount: string }[]
  }
}

export interface SettlementBreakdown {
  currency: Currency
  fxRateToBdt: string
  exitReason: ExitReason
  exitLabel: string
  lastWorkingDay: string
  serviceYears: string
  completedYears: number
  pendingSalary: {
    calendarDays: number
    daysEmployed: number
    payableDays: string
    grossPay: string
    totalDeductions: string
    netPay: string
  }
  /** Carries its own working, so a disputed figure can be explained. */
  gratuity: {
    eligible: boolean
    wagesBase: string
    daysPerYear: number
    completedYears: number
    amount: string
    reason: string
  }
  notice: { days: number; amount: string; reason: string }
  claims: Array<{
    claimId: string
    category: string
    spentCurrency: Currency
    spentAmount: string
    fxRateToBdt: string
  }>
}

export interface Settlement {
  id: string
  settlementNo: string
  employeeId: string
  status: SettlementStatus
  lastWorkingDay: string
  exitReason: ExitReason
  serviceYears: string
  currency: Currency
  fxRateToBdt: string
  pendingSalary: string
  gratuity: string
  noticePay: string
  expenseReimbursement: string
  leaveEncashment: string
  outstandingDeductions: string
  assetRecoveries: string
  finalAmount: string
  finalAmountBdt: string
  breakdown: SettlementBreakdown
  calculatedBy: string | null
  calculatedAt: string | null
  approvedBy: string | null
  approvedAt: string | null
  paidBy: string | null
  paidAt: string | null
  rejectionNote: string | null
  generatedAt: string
  employee?: { id: string; fullName: string; employeeCode: string; joiningDate: string }
  claims?: Array<{ id: string; category: string; amount: string; currency: Currency }>
}

export interface ExitDetailsInput {
  lastWorkingDay: string
  exitReason: ExitReason
  exitNote?: string
}

export interface SettlementOverrideInput {
  pendingSalary?: number
  gratuity?: number
  noticePay?: number
  expenseReimbursement?: number
  outstandingDeductions?: number
  assetRecoveries?: number
  reason: string
}
