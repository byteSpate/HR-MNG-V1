/**
 * Everything that must be true before a month can be paid.
 *
 * Returns a report and never throws, so the UI can render a checklist rather
 * than a wall — a gate that names who is blocking gets cleared; one that says
 * "cannot process" gets worked around. `assertProcessable` is the throwing
 * wrapper `processRun` (Task 8) actually gates on.
 */

import { getMonthlySummary } from "../attendance/attendance.summary"
import { monthRange } from "../attendance/attendance.service"
import { officeToday } from "../attendance/attendance.time"
import type { AccessTokenPayload } from "../auth/auth.types"
import prisma from "../../config/prisma"
import type { Currency, Prisma } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { computePayslip } from "./payroll.calc"
import { pickRate } from "./payroll.fx"
import { dec, REPORTING_CURRENCY } from "./payroll.money"
import type { ComponentInput } from "./payroll.types"

/**
 * Not a real user — `getMonthlySummary` scopes its roster by actor role, and
 * every non-staff role (HR, Finance, Super Admin) sees the same "everyone
 * still on the books" roster regardless of which one is passed. Preflight is
 * a system operation with no signed-in actor of its own, so this stands in
 * for one rather than threading a real user's token through a background
 * check.
 */
const SYSTEM_ACTOR: AccessTokenPayload = {
  sub: "system",
  role: "FINANCE_OFFICER",
  email: "system@payroll.internal",
  mustChangePassword: false,
  salesRole: null,
}

export type PreflightBlockerCode =
  | "MONTH_NOT_OVER"
  | "UNAPPROVED_ATTENDANCE"
  | "MISSING_SALARY_STRUCTURE"
  | "MISSING_EXCHANGE_RATE"
  | "NEGATIVE_NET_PAY"

export interface PreflightBlockerEmployee {
  employeeId: string
  fullName: string
  employeeCode: string
  /** Human-readable specifics — "2 days pending approval", a currency, etc. */
  detail: string
}

export interface PreflightBlocker {
  code: PreflightBlockerCode
  message: string
  employees: PreflightBlockerEmployee[]
}

export interface PreflightReport {
  month: number
  year: number
  ok: boolean
  blockers: PreflightBlocker[]
}

type StructureWithComponents = Prisma.SalaryStructureGetPayload<{ include: { components: true } }>

export interface PayrollRosterMember {
  id: string
  fullName: string
  employeeCode: string
  salaryStructureId: string | null
  salaryStructure: StructureWithComponents | null
}

/**
 * The population a payroll run pays: on the books (`ACTIVE`/`ON_LEAVE`) and
 * employed at least one day of the month. `RESIGNED`/`TERMINATED` are
 * excluded by the status filter — their money is the settlement's (Task 14).
 *
 * Deliberately **not** filtered to employees who already have a salary
 * structure — blocker 3 exists to find the ones who don't. `processRun`
 * (Task 8) reuses this and applies that filter itself once preflight has
 * confirmed it changes nothing.
 */
export async function loadPayrollRoster(
  month: number,
  year: number
): Promise<PayrollRosterMember[]> {
  const { to } = monthRange(year, month)
  return prisma.employee.findMany({
    where: {
      employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] },
      joiningDate: { lte: to },
    },
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      salaryStructureId: true,
      salaryStructure: { include: { components: true } },
    },
    orderBy: { fullName: "asc" },
  })
}

/**
 * Adapts a structure's raw component rows into `computePayslip`'s input
 * shape. Shared between this file's own blocker-5 dry run and `processRun`'s
 * real computation (`payroll.service.ts`) so the two can never quietly
 * diverge on how a component resolves.
 */
export function toComponentInputs(
  components: StructureWithComponents["components"]
): ComponentInput[] {
  return components.map((c) => ({
    code: c.code,
    label: c.label,
    kind: c.kind,
    calc: c.calc,
    value: dec(c.value),
    sortOrder: c.sortOrder,
  }))
}

export async function preflight(month: number, year: number): Promise<PreflightReport> {
  const blockers: PreflightBlocker[] = []
  const { to: monthEnd } = monthRange(year, month)

  // Blocker 1 — the month must be over in office-local time. A run over a
  // month still in progress would pay days that have not happened yet.
  if (officeToday().getTime() <= monthEnd.getTime()) {
    blockers.push({
      code: "MONTH_NOT_OVER",
      message: `${year}-${String(month).padStart(2, "0")} has not finished yet — payroll can only process a completed month.`,
      employees: [],
    })
  }

  const summaries = await getMonthlySummary(SYSTEM_ACTOR, month, year)
  const roster = await loadPayrollRoster(month, year)

  // Blocker 2 — no unapproved attendance. Listed by name: a gate that says
  // "cannot process" gets worked around, one that names who gets cleared.
  const pending = summaries.filter((s) => s.pendingApproval > 0)
  if (pending.length > 0) {
    blockers.push({
      code: "UNAPPROVED_ATTENDANCE",
      message: `${pending.length} employee(s) have unapproved attendance for ${year}-${String(month).padStart(2, "0")}.`,
      employees: pending.map((s) => ({
        employeeId: s.employee.id,
        fullName: s.employee.fullName,
        employeeCode: s.employee.employeeCode,
        detail: `${s.pendingApproval} day(s) pending approval`,
      })),
    })
  }

  // Blocker 3 — every roster employee has a salary structure.
  const unassigned = roster.filter((e) => !e.salaryStructure)
  if (unassigned.length > 0) {
    blockers.push({
      code: "MISSING_SALARY_STRUCTURE",
      message: `${unassigned.length} employee(s) have no salary structure assigned.`,
      employees: unassigned.map((e) => ({
        employeeId: e.id,
        fullName: e.fullName,
        employeeCode: e.employeeCode,
        detail: "No salary structure",
      })),
    })
  }

  // Blocker 4 — an exchange rate exists at month-end for every non-BDT
  // payment currency in the roster. Resolved with the same pickRate the run
  // itself will use, so this can never disagree with what process actually
  // does.
  const nonBdtCurrencies = new Set(
    roster
      .map((e) => e.salaryStructure?.currency)
      .filter((c): c is Currency => c !== undefined && c !== REPORTING_CURRENCY)
  )
  if (nonBdtCurrencies.size > 0) {
    const rates = await prisma.exchangeRate.findMany({
      where: { base: { in: [...nonBdtCurrencies] }, quote: REPORTING_CURRENCY },
    })
    const missingCurrencies = [...nonBdtCurrencies].filter(
      (currency) => !pickRate(rates.filter((r) => r.base === currency), monthEnd)
    )
    if (missingCurrencies.length > 0) {
      const affected = roster.filter(
        (e) => e.salaryStructure && missingCurrencies.includes(e.salaryStructure.currency)
      )
      blockers.push({
        code: "MISSING_EXCHANGE_RATE",
        message: `No exchange rate covers ${year}-${String(month).padStart(2, "0")} for: ${missingCurrencies.join(", ")}.`,
        employees: affected.map((e) => ({
          employeeId: e.id,
          fullName: e.fullName,
          employeeCode: e.employeeCode,
          detail: `Paid in ${e.salaryStructure!.currency}`,
        })),
      })
    }
  }

  // Blocker 5 — no payslip may compute a negative netPay. Requires computing
  // before deciding whether computing is allowed, so it runs last and only
  // once 1–4 are clear — otherwise it would report nonsense for an employee
  // missing a structure or a rate rather than the real blocker.
  //
  // A structure-and-attendance-only dry run: adjustments and reimbursements
  // are Tasks 10–11's concern and are not needed to reproduce either named
  // cause (a mis-entered percentage, or fixed deductions against a
  // heavily-LOP month) — `processRun` performs the full computation.
  if (blockers.length === 0) {
    const calendarDays = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const negative: PreflightBlockerEmployee[] = []

    for (const employee of roster) {
      const structure = employee.salaryStructure!
      const summary = summaries.find((s) => s.employee.id === employee.id)
      if (!summary) continue

      const result = computePayslip({
        basic: dec(structure.basic),
        components: toComponentInputs(structure.components),
        adjustments: [],
        reimbursements: [],
        calendarDays,
        workingDays: summary.workingDays,
        present: summary.present,
        absent: summary.absent,
        onPaidLeave: summary.onPaidLeave,
        onUnpaidLeave: summary.onUnpaidLeave,
      })

      if (result.netPay.isNegative()) {
        negative.push({
          employeeId: employee.id,
          fullName: employee.fullName,
          employeeCode: employee.employeeCode,
          detail: `netPay would be ${result.netPay.toFixed(2)} ${structure.currency}`,
        })
      }
    }

    if (negative.length > 0) {
      blockers.push({
        code: "NEGATIVE_NET_PAY",
        message: `${negative.length} employee(s) would have a negative net pay this month.`,
        employees: negative,
      })
    }
  }

  return { month, year, ok: blockers.length === 0, blockers }
}

export async function assertProcessable(month: number, year: number): Promise<void> {
  const report = await preflight(month, year)
  if (!report.ok) {
    throw new AppError(409, "Payroll cannot be processed for this month", { blockers: report.blockers })
  }
}
