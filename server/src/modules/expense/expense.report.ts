/**
 * Expense claims over a date range, per person or across everybody.
 *
 * Built the same way `attendance.report.ts` is, deliberately: one range
 * function, one shape, JSON / CSV / PDF off the same object. A second export
 * path would be a second place for the totals to be wrong.
 *
 * **The range is `expenseDate`, never `createdAt`.** A July taxi fare
 * submitted in August belongs to July — that distinction is already why the
 * two columns exist — and a report that ranged on submission date would put
 * the same spend in the wrong month for anybody who claims late, which is
 * everybody.
 *
 * **Scoping is the caller's identity, not a query parameter.** An employee
 * gets their own claims whatever `employeeId` they ask for; only Finance and
 * HR can name somebody else. Filtering after a role check would be the same
 * thing; filtering *instead of* one is how a person reads a colleague's
 * medical claim.
 */

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { MS_PER_DAY, parseDateOnly } from "../../utils/dates"
import { toCsv } from "../../utils/csv"
import type { AccessTokenPayload } from "../auth/auth.types"
import { requireEmployeeForUser } from "../attendance/attendance.service"
import { PAYROLL_ADMIN_ROLES } from "./expense.service"

/**
 * Two years. Longer than the attendance cap because a claim is one row per
 * spend rather than headcount × days, so the cost of a wide range is far
 * lower — but still a ceiling, because "everything" is not a report.
 */
export const MAX_REPORT_DAYS = 732

export type ExpenseReportStatus = "PENDING" | "APPROVED" | "REJECTED" | "REIMBURSED"

export interface ExpenseReportRow {
  id: string
  employee: { id: string; fullName: string; employeeCode: string }
  /**
   * What the claim is — "Water jar", "Taxi to Motijheel". Null on claims filed
   * before the field existed and with no description to backfill from; the
   * category is the fallback, since a row has to be identifiable by something.
   */
  name: string | null
  category: { code: string; name: string }
  expenseDate: string
  amount: string
  currency: string
  status: ExpenseReportStatus
  description: string | null
  /** Both null unless the category carries a route. */
  travelFrom: string | null
  travelTo: string | null
  /** How many receipts back this claim. Zero is the thing an approver looks for. */
  receipts: number
  /** The payslip that reimbursed it, when one has. */
  paidOn: string | null
}

export interface ExpenseReport {
  from: string
  to: string
  /** Present when the report was narrowed to one person. */
  employee: { id: string; fullName: string; employeeCode: string } | null
  status: ExpenseReportStatus | null
  rows: ExpenseReportRow[]
  totals: {
    claims: number
    /**
     * Money is summed **per currency**, never added together. A BDT total that
     * silently includes a USD claim is a number nobody can use and nobody can
     * spot — the whole reason `fxRateToBdt` is frozen at approval rather than
     * applied at read time.
     */
    byCurrency: { currency: string; claims: number; amount: string }[]
    byStatus: { status: ExpenseReportStatus; claims: number }[]
  }
}

export interface ExpenseReportQuery {
  from: string
  to: string
  employeeId?: string
  status?: ExpenseReportStatus
}

/** Validates and normalises the range. Shared by every output format. */
export function resolveRange(from: string, to: string): { start: Date; end: Date } {
  const start = parseDateOnly(from)
  const end = parseDateOnly(to)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new AppError(400, "`from` and `to` must be YYYY-MM-DD dates")
  }
  if (end.getTime() < start.getTime()) {
    throw new AppError(400, "`to` must not be earlier than `from`")
  }
  const span = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1
  if (span > MAX_REPORT_DAYS) {
    throw new AppError(400, `A report must not span more than ${MAX_REPORT_DAYS} days`)
  }
  return { start, end }
}

/** Decimal to a fixed-2 string, the way every money value crosses this API. */
const money = (value: { toFixed: (n: number) => string }) => value.toFixed(2)

export async function getExpenseReport(
  actor: AccessTokenPayload,
  query: ExpenseReportQuery
): Promise<ExpenseReport> {
  const { start, end } = resolveRange(query.from, query.to)

  // Who this report is allowed to be about, decided from the token.
  let employeeId = query.employeeId
  if (!PAYROLL_ADMIN_ROLES.includes(actor.role)) {
    const self = await requireEmployeeForUser(actor.sub)
    if (employeeId && employeeId !== self.id) {
      throw new AppError(403, "You may only report on your own expense claims")
    }
    employeeId = self.id
  }

  const rows = await prisma.expenseClaim.findMany({
    where: {
      // Inclusive at both ends: `expenseDate` is stored at UTC midnight, so
      // `lte end` catches the end date itself.
      expenseDate: { gte: start, lte: end },
      ...(employeeId ? { employeeId } : {}),
      ...(query.status ? { status: query.status } : {}),
    },
    include: {
      employee: { select: { id: true, fullName: true, employeeCode: true } },
      category: { select: { code: true, name: true } },
      payslip: { select: { payslipNo: true } },
      _count: { select: { attachments: true } },
    },
    // Date then person, so a range reads as a diary rather than as one
    // person's history interleaved with everybody else's.
    orderBy: [{ expenseDate: "asc" }, { employeeId: "asc" }],
  })

  const byCurrency = new Map<string, { claims: number; amount: number }>()
  const byStatus = new Map<ExpenseReportStatus, number>()

  const mapped: ExpenseReportRow[] = rows.map((claim) => {
    const currency = String(claim.currency)
    const bucket = byCurrency.get(currency) ?? { claims: 0, amount: 0 }
    bucket.claims++
    bucket.amount += Number(claim.amount)
    byCurrency.set(currency, bucket)

    const status = claim.status as ExpenseReportStatus
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1)

    return {
      id: claim.id,
      employee: claim.employee,
      name: claim.name,
      category: claim.category,
      expenseDate: claim.expenseDate.toISOString().slice(0, 10),
      amount: money(claim.amount),
      currency,
      status,
      description: claim.description,
      travelFrom: claim.travelFrom,
      travelTo: claim.travelTo,
      receipts: claim._count.attachments,
      paidOn: claim.payslip?.payslipNo ?? null,
    }
  })

  // Present only when the whole report is about one person — otherwise the
  // header would name whoever happened to file the first claim.
  const employee = employeeId ? (mapped[0]?.employee ?? null) : null

  return {
    from: query.from,
    to: query.to,
    employee,
    status: query.status ?? null,
    rows: mapped,
    totals: {
      claims: mapped.length,
      byCurrency: [...byCurrency.entries()]
        .map(([currency, b]) => ({ currency, claims: b.claims, amount: b.amount.toFixed(2) }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
      byStatus: [...byStatus.entries()]
        .map(([status, claims]) => ({ status, claims }))
        .sort((a, b) => a.status.localeCompare(b.status)),
    },
  }
}

const HEADERS = [
  "Date",
  "EmployeeCode",
  // "Name" split in two once claims gained one of their own. It used to mean
  // the employee, which reads as the expense's name the moment there is one.
  "Employee",
  "Expense",
  "CategoryCode",
  "Category",
  "Description",
  "From",
  "To",
  "Amount",
  "Currency",
  "Status",
  "Receipts",
  "ReimbursedOn",
] as const

export function reportToCsv(report: ExpenseReport): string {
  return toCsv(
    HEADERS,
    report.rows.map((r) => [
      r.expenseDate,
      r.employee.employeeCode,
      r.employee.fullName,
      r.name ?? "",
      r.category.code,
      r.category.name,
      r.description ?? "",
      r.travelFrom ?? "",
      r.travelTo ?? "",
      r.amount,
      r.currency,
      r.status,
      String(r.receipts),
      r.paidOn ?? "",
    ])
  )
}

/** The range is in the filename because a downloads folder loses context. */
export function reportFilename(report: ExpenseReport, ext: "csv" | "pdf"): string {
  const who = report.employee ? `-${report.employee.employeeCode}` : ""
  return `expenses${who}-${report.from}-to-${report.to}.${ext}`
}
