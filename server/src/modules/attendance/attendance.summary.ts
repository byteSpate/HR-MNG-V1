/**
 * Daily and monthly rollups over the derived day grid.
 *
 * `summariseMonth` is the payroll contract: payroll imports it rather than
 * re-deriving from `Attendance` rows, because status is computed rather than
 * stored, so this function *is* the source of truth. Two implementations of
 * the day grid would drift, and the one living in payroll would be the one
 * nobody tests.
 */

import prisma from "../../config/prisma"
import type { Employee } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { MS_PER_DAY, formatDateOnly, parseDateOnly } from "../../utils/dates"
import type { AccessTokenPayload } from "../auth/auth.types"
import { buildDayGrid, eachDate } from "./attendance.grid"
import { officeToday } from "./attendance.time"
import { monthRange, requireEmployeeForUser } from "./attendance.service"
import type {
  AttendanceDay,
  DailySummary,
  EmployeeRef,
  GridEmployee,
  MonthlyAttendanceSummary,
  WeeklySummary,
  WeeklySummaryDay,
} from "./attendance.types"

const ROSTER_SELECT = {
  id: true,
  fullName: true,
  employeeCode: true,
  designation: true,
  joiningDate: true,
  employmentStatus: true,
  shiftId: true,
  // The grid clips a leaver here rather than at today.
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

/**
 * Who the caller may see, resolved once and reused by both summaries.
 *
 * An employee gets a one-row roster rather than a 403, so the route shape
 * stays uniform across roles and the client does not need a special case
 * for "you are not allowed to ask this at all".
 */
export async function rosterFor(actor: AccessTokenPayload): Promise<RosterEmployee[]> {
  if (actor.role === "EMPLOYEE") {
    const self = await requireEmployeeForUser(actor.sub)
    const row = await prisma.employee.findUnique({
      where: { id: self.id },
      select: ROSTER_SELECT,
    })
    return row ? [row] : []
  }

  if (actor.role === "REPORTING_MANAGER") {
    const self = await requireEmployeeForUser(actor.sub)
    return prisma.employee.findMany({
      where: {
        OR: [{ id: self.id }, { reportingManagerId: self.id }],
        employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] },
      },
      select: ROSTER_SELECT,
      orderBy: { fullName: "asc" },
    })
  }

  // HR, Super Admin, Finance: everyone still on the books. People who have
  // resigned or been terminated drop off the board rather than accruing
  // absences on it.
  return prisma.employee.findMany({
    where: { employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] } },
    select: ROSTER_SELECT,
    orderBy: { fullName: "asc" },
  })
}

export async function getDailySummary(
  actor: AccessTokenPayload,
  date?: string
): Promise<DailySummary> {
  const day = date ? new Date(`${date}T00:00:00.000Z`) : officeToday()
  const roster = await rosterFor(actor)
  const grid = await buildDayGrid(roster.map(toGridEmployee), day, day)

  const totals = {
    present: 0,
    late: 0,
    absent: 0,
    onLeave: 0,
    holiday: 0,
    weeklyOff: 0,
    notCheckedIn: 0,
    pendingApproval: 0,
  }
  const rows: DailySummary["rows"] = []
  const conflicts: DailySummary["conflicts"] = []

  for (const employee of roster) {
    const entry = grid.get(employee.id)?.[0]
    if (!entry || entry.status === "NOT_TRACKED") continue

    switch (entry.status) {
      case "PRESENT":
        totals.present++
        if (entry.isLate) totals.late++
        break
      case "ABSENT":
        totals.absent++
        break
      case "ON_LEAVE":
        totals.onLeave++
        break
      case "HOLIDAY":
        totals.holiday++
        break
      case "WEEKLY_OFF":
        totals.weeklyOff++
        break
      case "NOT_CHECKED_IN":
        totals.notCheckedIn++
        break
    }
    if (entry.approval === "PENDING") totals.pendingApproval++

    rows.push({
      employee: toRef(employee),
      status: entry.status,
      checkIn: entry.checkIn,
      checkOut: entry.checkOut,
      workedHours: entry.workedHours,
      isLate: entry.isLate,
      isEarlyOut: entry.isEarlyOut,
      approval: entry.approval,
      detail: entry.detail,
    })
  }

  // Checking in while on approved leave is allowed rather than blocked — a
  // 409 would leave somebody who genuinely came in unable to record real
  // work. It surfaces here for a human to resolve instead.
  const onLeaveIds = await leaveConflictIds(
    roster.map((e) => e.id),
    day
  )
  for (const employee of roster) {
    const entry = grid.get(employee.id)?.[0]
    if (entry?.status === "PRESENT" && onLeaveIds.has(employee.id)) {
      conflicts.push({
        employeeId: employee.id,
        fullName: employee.fullName,
        reason: "CHECKED_IN_WHILE_ON_LEAVE",
      })
    }
  }

  return { date: formatDateOnly(day), totals, rows, conflicts }
}

async function leaveConflictIds(employeeIds: string[], date: Date): Promise<Set<string>> {
  if (employeeIds.length === 0) return new Set()
  const leaves = await prisma.leaveRequest.findMany({
    where: {
      employeeId: { in: employeeIds },
      status: "APPROVED",
      startDate: { lte: date },
      endDate: { gte: date },
    },
    select: {
      employeeId: true,
      startDate: true,
      endDate: true,
      startSession: true,
      endSession: true,
    },
  })
  return new Set(
    leaves
      // A half-day is *expected* to have a check-in for the other half, so it
      // is not an anomaly for a human to resolve. Only a whole-day leave with
      // a punch against it is worth surfacing.
      .filter((l) => {
        const key = formatDateOnly(date)
        const startsHalf = key === formatDateOnly(l.startDate) && l.startSession === "SECOND_HALF"
        const endsHalf = key === formatDateOnly(l.endDate) && l.endSession === "FIRST_HALF"
        return !startsHalf && !endsHalf
      })
      .map((l) => l.employeeId)
  )
}

/**
 * The longest range this will roll up. A weekly chart asks for seven days and
 * a monthly one for thirty-one; anything past that is either a mistake or a
 * full-history scan wearing a date range, and the grid is derived per
 * employee per day, so the cost is headcount × days.
 */
const MAX_RANGE_DAYS = 31

/**
 * A present-count per calendar day across the caller's roster.
 *
 * Exists so the manager's weekly chart is one grid build rather than five.
 * `getDailySummary` is left untouched: it is a payroll-adjacent contract with
 * its own tests, and widening it into a range function would change a
 * signature four call sites depend on.
 */
export async function getWeeklySummary(
  actor: AccessTokenPayload,
  from: string,
  to: string
): Promise<WeeklySummary> {
  const start = parseDateOnly(from)
  const end = parseDateOnly(to)
  if (end.getTime() < start.getTime()) {
    throw new AppError(400, "`to` must not be earlier than `from`")
  }
  const span = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1
  if (span > MAX_RANGE_DAYS) {
    throw new AppError(400, `Range must not exceed ${MAX_RANGE_DAYS} days`)
  }

  const roster = await rosterFor(actor)
  const grid = await buildDayGrid(roster.map(toGridEmployee), start, end)

  // Seeded from the dates rather than the grid, so a day nobody has any
  // entry for — an empty roster, or a range entirely before go-live — is
  // still a bar on the chart instead of a silent gap.
  const days = new Map<string, WeeklySummaryDay>()
  for (const date of eachDate(start, end)) {
    days.set(date, {
      date,
      kind: "WORKING",
      present: 0,
      late: 0,
      absent: 0,
      onLeave: 0,
      notCheckedIn: 0,
    })
  }

  // Tracks whether any employee was scheduled to work each day, so `kind`
  // can report the roster-wide answer rather than the last employee's.
  const worked = new Set<string>()
  const holidays = new Set<string>()

  for (const employee of roster) {
    for (const entry of grid.get(employee.id) ?? []) {
      const day = days.get(entry.date)
      if (!day || entry.status === "NOT_TRACKED") continue

      if (entry.isWorkingDay) worked.add(entry.date)
      else if (entry.isHoliday) holidays.add(entry.date)

      switch (entry.status) {
        case "PRESENT":
          day.present++
          if (entry.isLate) day.late++
          break
        case "ABSENT":
          day.absent++
          break
        case "ON_LEAVE":
          day.onLeave++
          break
        case "NOT_CHECKED_IN":
          day.notCheckedIn++
          break
      }
    }
  }

  for (const day of days.values()) {
    if (worked.has(day.date)) day.kind = "WORKING"
    else if (holidays.has(day.date)) day.kind = "HOLIDAY"
    else if (grid.size > 0) day.kind = "WEEKLY_OFF"
  }

  return {
    from: formatDateOnly(start),
    to: formatDateOnly(end),
    headcount: roster.length,
    days: [...days.values()],
  }
}

/** Rolls a single employee's day grid into the payroll contract shape. */
export function summariseDays(
  employee: EmployeeRef,
  days: AttendanceDay[],
  month: number,
  year: number
): MonthlyAttendanceSummary {
  const summary: MonthlyAttendanceSummary = {
    employee,
    month,
    year,
    workingDays: 0,
    present: 0,
    absent: 0,
    onLeave: 0,
    onPaidLeave: 0,
    onUnpaidLeave: 0,
    notCheckedIn: 0,
    late: 0,
    earlyOut: 0,
    holidays: 0,
    weeklyOffs: 0,
    workedOnOffDays: 0,
    workedHours: 0,
    workedHoursOnWorkingDays: 0,
    workingDaysFullyRecorded: 0,
    expectedHours: 0,
    shortfallHours: 0,
    missingCheckOut: 0,
    pendingApproval: 0,
    approved: 0,
    regularised: 0,
    rejected: 0,
  }

  for (const day of days) {
    if (day.status === "NOT_TRACKED") continue

    if (day.isWorkingDay) {
      summary.workingDays++
      summary.expectedHours += day.expectedHours

      // Leave first, whatever the status says. A half-day is PRESENT *and*
      // partly leave, so the two shares are counted independently and the
      // four-term identity
      //   present + absent + onLeave + notCheckedIn === workingDays
      // — the identity payroll's denominator depends on — holds over
      // fractions rather than being broken by them.
      if (day.leaveFraction > 0) {
        // `onLeave` stays the total; the paid/unpaid split sits inside it.
        summary.onLeave += day.leaveFraction
        // An unknown flag counts as paid: a null here means the grid could
        // not say, and deducting on an unknown would take money off somebody
        // on the strength of missing data.
        if (day.leaveIsPaid === false) summary.onUnpaidLeave += day.leaveFraction
        else summary.onPaidLeave += day.leaveFraction
      }

      // The complement — the part of the day that was not leave.
      const workShare = 1 - day.leaveFraction
      if (workShare > 0) {
        switch (day.status) {
          case "PRESENT":
            summary.present += workShare
            break
          case "ABSENT":
            summary.absent += workShare
            break
          case "NOT_CHECKED_IN":
            summary.notCheckedIn += workShare
            break
          case "ON_LEAVE":
            // A partial leave nobody punched for: the working half was owed
            // and not served. Crediting `present` here would pay for a half
            // day nobody worked.
            if (day.unservedStatus === "ABSENT") summary.absent += workShare
            else if (day.unservedStatus === "NOT_CHECKED_IN") summary.notCheckedIn += workShare
            break
        }
      }
    } else {
      // Counted outside the working-day identity on purpose: a Friday
      // somebody chose to work is not a day the roster scheduled, and
      // folding it into `present` would inflate the denominator payroll
      // divides by.
      //
      // A holiday landing on the weekly off counts once, as a holiday.
      if (day.isHoliday) summary.holidays++
      else if (day.isWeeklyOff) summary.weeklyOffs++

      if (day.attendanceId) summary.workedOnOffDays++
    }

    if (day.attendanceId) {
      if (day.approval === "REJECTED") {
        // A rejected record is not an attendance, so none of its flags or
        // hours may feed a statistic — otherwise payroll would be handed
        // time that was explicitly refused. It is still reported, because
        // "three of this person's claims were rejected" is exactly what a
        // reviewer needs to see.
        summary.rejected++
      } else {
        if (day.isLate) summary.late++
        if (day.isEarlyOut) summary.earlyOut++
        if (day.regularised) summary.regularised++
        if (day.approval === "PENDING") summary.pendingApproval++
        if (day.approval === "APPROVED") summary.approved++

        if (day.checkIn && !day.checkOut) {
          // Never guessed from the shift end — a fabricated number would be
          // indistinguishable from a measured one, and it feeds payroll.
          summary.missingCheckOut++
        } else if (day.workedHours !== null) {
          summary.workedHours += day.workedHours
          if (day.isWorkingDay) {
            summary.shortfallHours += Math.max(0, day.expectedHours - day.workedHours)
            // The matched pair the hours-per-day card divides. Both sides are
            // inside this branch, so a missing check-out — which lands in the
            // `if` above — is excluded from each of them together.
            summary.workedHoursOnWorkingDays += day.workedHours
            if (day.checkIn && day.checkOut) summary.workingDaysFullyRecorded++
          }
        }
      }
    }
  }

  summary.workedHours = round2(summary.workedHours)
  summary.expectedHours = round2(summary.expectedHours)
  summary.shortfallHours = round2(summary.shortfallHours)
  // The day counters are fractional now, so float artefacts are reachable:
  // three half-days sum to 1.5000000000000002 without this, and that number
  // reaches a payslip.
  summary.present = round2(summary.present)
  summary.absent = round2(summary.absent)
  summary.onLeave = round2(summary.onLeave)
  summary.onPaidLeave = round2(summary.onPaidLeave)
  summary.onUnpaidLeave = round2(summary.onUnpaidLeave)
  summary.notCheckedIn = round2(summary.notCheckedIn)
  return summary
}

const round2 = (n: number) => Math.round(n * 100) / 100

export async function getMonthlySummary(
  actor: AccessTokenPayload,
  month?: number,
  year?: number
): Promise<MonthlyAttendanceSummary[]> {
  const today = officeToday()
  const targetYear = year ?? today.getUTCFullYear()
  const targetMonth = month ?? today.getUTCMonth() + 1
  const { from, to } = monthRange(targetYear, targetMonth)

  const roster = await rosterFor(actor)
  const grid = await buildDayGrid(roster.map(toGridEmployee), from, to)

  return roster.map((employee) =>
    summariseDays(toRef(employee), grid.get(employee.id) ?? [], targetMonth, targetYear)
  )
}
