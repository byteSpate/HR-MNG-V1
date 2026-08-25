/**
 * Attendance reports over an arbitrary date range.
 *
 * One range function serves all four things HR asked for, because they are the
 * same question with different bounds:
 *
 * - a daily report is `from === to`
 * - a weekly report is a seven-day range
 * - a monthly report is a calendar month
 * - a custom report is whatever the user picked
 *
 * Building four endpoints would have meant four places for the counting rules
 * to drift apart, and the counting rules are the part that reaches payroll.
 *
 * Two granularities, because two genuinely different documents are wanted:
 * `summary` is one row per employee with their totals, `daily` is one row per
 * employee per day. A weekly summary answers "who is short this week"; the
 * daily rows answer "what happened on the 14th".
 *
 * Nothing is recomputed here. Both granularities read the same derived day
 * grid every other consumer reads, and the summary rolls up through
 * `summariseDays` — the function payroll already trusts.
 */

import { env } from "../../config/env"
import prisma from "../../config/prisma"
import type { Employee } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { MS_PER_DAY, formatDateOnly, parseDateOnly } from "../../utils/dates"
import { toCsv } from "../../utils/csv"
import type { AccessTokenPayload } from "../auth/auth.types"
import { buildDayGrid } from "./attendance.grid"
import { rosterFor, summariseDays } from "./attendance.summary"
import type {
  AttendanceDay,
  EmployeeRef,
  GridEmployee,
  MonthlyAttendanceSummary,
} from "./attendance.types"

/**
 * A year, where the dashboard rollups cap at 31.
 *
 * A report is an occasional, deliberate act — somebody clicked Export and is
 * waiting for a file — where the weekly chart is polled by every open
 * dashboard. The cost is still headcount × days, so this is a real ceiling and
 * not a formality: 366 is "the financial year I am closing", and anything past
 * it is a full-history scan wearing a date range.
 */
export const MAX_REPORT_DAYS = 366

export type ReportGranularity = "summary" | "daily"

/**
 * Per-employee totals for the range. The month/year of the payroll contract
 * are meaningless across an arbitrary range, so they are dropped.
 *
 * `department` sits beside `employee` rather than inside `EmployeeRef`:
 * that ref is shared with the approvals and summary payloads, and widening it
 * would make every one of them carry a join they do not read.
 */
export type AttendanceReportRow = Omit<MonthlyAttendanceSummary, "month" | "year"> & {
  department: string
}

/** One employee on one date — the day grid, flattened for reading. */
export interface AttendanceReportDay {
  employee: EmployeeRef
  department: string
  date: string
  status: AttendanceDay["status"]
  isWorkingDay: boolean
  checkIn: string | null
  checkOut: string | null
  workedHours: number | null
  expectedHours: number
  isLate: boolean
  isEarlyOut: boolean
  approval: AttendanceDay["approval"]
  regularised: boolean
  /** The nightly job closed this day; nobody punched out. */
  autoCheckOut: boolean
  detail: string | null
}

export interface AttendanceReport {
  from: string
  to: string
  granularity: ReportGranularity
  /** Roster size the report was built over, so a reader can tell an empty
   *  range from an empty company. */
  headcount: number
  /** Present only for `granularity: "summary"`. */
  rows: AttendanceReportRow[]
  /**
   * Present for `granularity: "daily"`, and *also* for a one-day range under
   * either granularity — a single day is the one range where the per-day view
   * is the useful one. See `singleDay` in `getAttendanceReport`.
   */
  days: AttendanceReportDay[]
  /** Range-wide totals, so the client never re-adds columns the server owns. */
  totals: {
    workingDays: number
    present: number
    absent: number
    onLeave: number
    notCheckedIn: number
    late: number
    earlyOut: number
    workedHours: number
    expectedHours: number
    shortfallHours: number
    missingCheckOut: number
    pendingApproval: number
  }
}

const ROSTER_SELECT = {
  id: true,
  fullName: true,
  employeeCode: true,
  designation: true,
  joiningDate: true,
  employmentStatus: true,
  shiftId: true,
  lastWorkingDay: true,
} as const

type RosterEmployee = Pick<Employee, keyof typeof ROSTER_SELECT>

const toRef = (e: RosterEmployee): EmployeeRef => ({
  id: e.id,
  fullName: e.fullName,
  employeeCode: e.employeeCode,
  designation: e.designation,
})

const toGridEmployee = (e: RosterEmployee): GridEmployee => ({
  id: e.id,
  joiningDate: e.joiningDate,
  employmentStatus: e.employmentStatus,
  shiftId: e.shiftId,
  lastWorkingDay: e.lastWorkingDay,
})

const round2 = (n: number) => Math.round(n * 100) / 100

/** Shown when the join comes back empty, which the schema says cannot happen
 *  — `departmentId` is required — but a printed dash beats a blank cell. */
const NO_DEPARTMENT = "—"

/**
 * Department names for a roster, in one query.
 *
 * Separate from `rosterFor` on purpose. That select is shared with the daily
 * and monthly summaries and with payroll's contract; adding a relation to it
 * would put a join on every attendance rollup in the system to serve one
 * column on one report.
 */
async function departmentNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await prisma.employee.findMany({
    where: { id: { in: ids } },
    select: { id: true, department: { select: { name: true } } },
  })
  return new Map(rows.map((r) => [r.id, r.department?.name ?? NO_DEPARTMENT]))
}

/**
 * Validates and normalises the range.
 *
 * Separate from the query so the same rules can be asserted directly, and so
 * the CSV and JSON paths cannot disagree about what range they served.
 */
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

export async function getAttendanceReport(
  actor: AccessTokenPayload,
  input: { from: string; to: string; granularity?: ReportGranularity; employeeId?: string }
): Promise<AttendanceReport> {
  const { start, end } = resolveRange(input.from, input.to)
  const granularity = input.granularity ?? "summary"

  // Scoped through `rosterFor`, never through the query: it already encodes
  // who each role may see, and an `employeeId` filter applied before that
  // check would let a manager report on somebody outside their team.
  let roster = (await rosterFor(actor)) as RosterEmployee[]
  if (input.employeeId) {
    roster = roster.filter((e) => e.id === input.employeeId)
    if (roster.length === 0) {
      throw new AppError(404, "That employee is not on a roster you can report on")
    }
  }

  const [grid, departments] = await Promise.all([
    buildDayGrid(roster.map(toGridEmployee), start, end),
    departmentNames(roster.map((e) => e.id)),
  ])

  /**
   * A one-day range gets its day rows whatever the granularity, because a
   * one-day *summary* is not a document anybody wants: "working days 1,
   * present 1" per person says less than "in 09:14, out 18:02". The PDF reads
   * this to lay a single day out differently — see `attendance.report.pdf.ts`.
   */
  const singleDay = start.getTime() === end.getTime()

  const rows: AttendanceReportRow[] = []
  const days: AttendanceReportDay[] = []
  const totals: AttendanceReport["totals"] = {
    workingDays: 0,
    present: 0,
    absent: 0,
    onLeave: 0,
    notCheckedIn: 0,
    late: 0,
    earlyOut: 0,
    workedHours: 0,
    expectedHours: 0,
    shortfallHours: 0,
    missingCheckOut: 0,
    pendingApproval: 0,
  }

  for (const employee of roster) {
    const ref = toRef(employee)
    const department = departments.get(employee.id) ?? NO_DEPARTMENT
    const employeeDays = grid.get(employee.id) ?? []

    // The month/year arguments are echoed straight back into the result and
    // used for nothing else, so passing the range's start is safe and keeps
    // one rollup implementation rather than two.
    const { month: _m, year: _y, ...summary } = summariseDays(
      ref,
      employeeDays,
      start.getUTCMonth() + 1,
      start.getUTCFullYear()
    )

    // Totals come off the rolled-up summary in both granularities. Re-adding
    // them from the flat day list would double-count half-days, which are
    // deliberately fractional.
    totals.workingDays += summary.workingDays
    totals.present += summary.present
    totals.absent += summary.absent
    totals.onLeave += summary.onLeave
    totals.notCheckedIn += summary.notCheckedIn
    totals.late += summary.late
    totals.earlyOut += summary.earlyOut
    totals.workedHours += summary.workedHours
    totals.expectedHours += summary.expectedHours
    totals.shortfallHours += summary.shortfallHours
    totals.missingCheckOut += summary.missingCheckOut
    totals.pendingApproval += summary.pendingApproval

    if (granularity === "summary") {
      rows.push({ ...summary, department })
      if (!singleDay) continue
    }

    for (const day of employeeDays) {
      // A day before go-live or outside employment is not a fact about this
      // employee, and printing it as a blank row invites the reader to treat
      // it as an absence.
      if (day.status === "NOT_TRACKED") continue
      days.push({
        employee: ref,
        department,
        date: day.date,
        status: day.status,
        isWorkingDay: day.isWorkingDay,
        checkIn: day.checkIn,
        checkOut: day.checkOut,
        workedHours: day.workedHours,
        expectedHours: day.expectedHours,
        isLate: day.isLate,
        isEarlyOut: day.isEarlyOut,
        approval: day.approval,
        regularised: day.regularised,
        autoCheckOut: day.autoCheckOut,
        detail: day.detail,
      })
    }
  }

  // Half-days make every one of these a float sum; three of them land on
  // 1.5000000000000002 without this, and that number reaches a printed report.
  for (const key of Object.keys(totals) as Array<keyof AttendanceReport["totals"]>) {
    totals[key] = round2(totals[key])
  }

  // Date then name, so a daily report reads as a day's register rather than as
  // one employee's history interleaved with everybody else's.
  days.sort((a, b) =>
    a.date === b.date ? a.employee.fullName.localeCompare(b.employee.fullName) : a.date.localeCompare(b.date)
  )

  return {
    from: formatDateOnly(start),
    to: formatDateOnly(end),
    granularity,
    headcount: roster.length,
    rows,
    days,
    totals,
  }
}

const SUMMARY_HEADERS = [
  "EmployeeCode",
  "Name",
  "Department",
  "Designation",
  "WorkingDays",
  "Present",
  "Absent",
  "OnLeave",
  "OnPaidLeave",
  "OnUnpaidLeave",
  "NotCheckedIn",
  "Late",
  "EarlyOut",
  "Holidays",
  "WeeklyOffs",
  "WorkedOnOffDays",
  "WorkedHours",
  "ExpectedHours",
  "ShortfallHours",
  "MissingCheckOut",
  "PendingApproval",
  "Approved",
  "Regularised",
  "Rejected",
] as const

const DAILY_HEADERS = [
  "Date",
  "EmployeeCode",
  "Name",
  "Department",
  "Designation",
  "Status",
  "WorkingDay",
  "CheckIn",
  "CheckOut",
  "WorkedHours",
  "ExpectedHours",
  "Late",
  "EarlyOut",
  "Approval",
  "Regularised",
  "AutoCheckOut",
  "Detail",
] as const

/**
 * Times as office-local clock values — a reader opening this in Excel, or
 * holding the printed page, wants "09:14", not a UTC instant they have to
 * convert in their head. Exported because the PDF renderer needs the same
 * conversion, and two of them would drift.
 */
export function clock(iso: string | null): string {
  if (!iso) return ""
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    // `APP_TIMEZONE`, not `process.env.TZ`. It is the source every other
    // office-time decision in this codebase reads — the business day, the cron
    // schedules, the dashboard formatter — and a deployment that sets one and
    // not the other would have printed check-in times on a different clock
    // from the rest of the system.
    timeZone: env.APP_TIMEZONE,
  })
}

const yesNo = (value: boolean) => (value ? "Yes" : "No")
const num = (value: number | null) => (value === null ? "" : String(value))

export function reportToCsv(report: AttendanceReport): string {
  if (report.granularity === "daily") {
    return toCsv(
      DAILY_HEADERS,
      report.days.map((d) => [
        d.date,
        d.employee.employeeCode,
        d.employee.fullName,
        d.department,
        d.employee.designation,
        d.status,
        yesNo(d.isWorkingDay),
        clock(d.checkIn),
        clock(d.checkOut),
        num(d.workedHours),
        String(d.expectedHours),
        yesNo(d.isLate),
        yesNo(d.isEarlyOut),
        d.approval ?? "",
        yesNo(d.regularised),
        yesNo(d.autoCheckOut),
        d.detail ?? "",
      ])
    )
  }

  return toCsv(
    SUMMARY_HEADERS,
    report.rows.map((r) => [
      r.employee.employeeCode,
      r.employee.fullName,
      r.department,
      r.employee.designation,
      String(r.workingDays),
      String(r.present),
      String(r.absent),
      String(r.onLeave),
      String(r.onPaidLeave),
      String(r.onUnpaidLeave),
      String(r.notCheckedIn),
      String(r.late),
      String(r.earlyOut),
      String(r.holidays),
      String(r.weeklyOffs),
      String(r.workedOnOffDays),
      String(r.workedHours),
      String(r.expectedHours),
      String(r.shortfallHours),
      String(r.missingCheckOut),
      String(r.pendingApproval),
      String(r.approved),
      String(r.regularised),
      String(r.rejected),
    ])
  )
}

/**
 * `attendance-summary-2026-08-01-to-2026-08-25.pdf` — the range is in the
 * filename because a downloads folder is where reports go to lose context.
 */
export function reportFilename(report: AttendanceReport, ext: "csv" | "pdf" = "csv"): string {
  return `attendance-${report.granularity}-${report.from}-to-${report.to}.${ext}`
}
