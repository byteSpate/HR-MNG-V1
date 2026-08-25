import type { Tone } from "@/components/dashboard/types"
import type {
  ExpenseStatus,
  PayrollStatus,
  PreflightBlockerCode,
  SettlementStatus,
} from "@/lib/api/types"

export const RUN_STATUS_TONE: Record<PayrollStatus, Tone> = {
  DRAFT: "neutral",
  SUBMITTED: "yellow",
  APPROVED: "green",
  DISBURSED: "green",
}

export const RUN_STATUS_LABEL: Record<PayrollStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  DISBURSED: "Disbursed",
}

export const EXPENSE_STATUS_TONE: Record<ExpenseStatus, Tone> = {
  PENDING: "yellow",
  APPROVED: "green",
  REJECTED: "red",
  REIMBURSED: "green",
}

export const EXPENSE_STATUS_LABEL: Record<ExpenseStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  REIMBURSED: "Reimbursed",
}

export const SETTLEMENT_STATUS_TONE: Record<SettlementStatus, Tone> = {
  DRAFT: "neutral",
  APPROVED: "yellow",
  PAID: "green",
}

export const SETTLEMENT_STATUS_LABEL: Record<SettlementStatus, string> = {
  DRAFT: "Draft",
  APPROVED: "Approved",
  PAID: "Paid",
}

/**
 * Where each blocker gets fixed.
 *
 * A gate that says "cannot process run" gets worked around. One that says
 * "Ayesha Rahman has 2 unapproved days — approve them" gets cleared, and
 * pointing at the screen that clears it is the difference.
 */
export const BLOCKER_FIX: Record<PreflightBlockerCode, { title: string; fix: string; href?: string }> =
  {
    MONTH_NOT_OVER: {
      title: "The month has not finished",
      fix: "Payroll can only process a completed month. Wait until the month ends.",
    },
    UNAPPROVED_ATTENDANCE: {
      title: "Attendance is still unapproved",
      fix: "Approve the outstanding records in the attendance approvals queue.",
      href: "/attendance",
    },
    MISSING_SALARY_STRUCTURE: {
      title: "Some employees have no salary structure",
      fix: "Assign a structure to each employee listed below.",
      href: "/employees",
    },
    MISSING_EXCHANGE_RATE: {
      title: "No exchange rate covers this month",
      fix: "Add a rate effective on or before month-end. Payroll never assumes one.",
    },
    NEGATIVE_NET_PAY: {
      title: "Some payslips would compute a negative net pay",
      fix: "Deductions exceed earnings for the employees below. HR resolves this with an adjustment.",
    },
  }

export const EXIT_REASON_LABEL: Record<string, string> = {
  RESIGNATION: "Resignation (§27)",
  RETIREMENT: "Retirement (§28)",
  TERMINATION: "Termination by employer (§26)",
  DISMISSAL: "Dismissal for misconduct (§23)",
  DISCHARGE: "Discharge on health grounds (§22)",
  RETRENCHMENT: "Retrenchment (§20)",
  CONTRACT_END: "Fixed-term contract expiry",
  DEATH: "Death in service",
}

/** What each exit reason drives, so the choice reads as a money decision. */
export const EXIT_REASON_EFFECT: Record<string, string> = {
  RESIGNATION: "Gratuity after 1 year · 60 days' notice expected from the worker",
  RETIREMENT: "Gratuity after 1 year · no notice period",
  TERMINATION: "Gratuity after 1 year · 120 days' notice owed by the employer",
  DISMISSAL: "No gratuity under the ordinary §23 reading · no notice",
  DISCHARGE: "Gratuity after 1 year · no notice period",
  RETRENCHMENT: "Gratuity after 1 year · 30 days' notice owed by the employer",
  CONTRACT_END: "Gratuity after 1 year · no notice period",
  DEATH: "Gratuity after 1 year · no notice period",
}

/** Roles that administer payroll. */
export const PAYROLL_ADMIN_ROLES = ["HR_ADMIN", "FINANCE_OFFICER", "SUPER_ADMIN"]
export const FINANCE_ROLES = ["FINANCE_OFFICER", "SUPER_ADMIN"]
export const HR_ROLES = ["HR_ADMIN", "SUPER_ADMIN"]
/** Roles with an Employee profile, and therefore a payslip of their own. */
export const STAFF_ROLES = ["EMPLOYEE", "REPORTING_MANAGER"]

/** Triggers a browser download for a blob the API returned. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoked on a later tick, never synchronously after `click()`. The click
  // only *schedules* the download; the browser still has to read the blob
  // behind the object URL. Revoking in the same task pulls that URL away
  // before it is read, which is why the download appeared to do nothing.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
