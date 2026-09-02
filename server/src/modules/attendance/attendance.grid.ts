/**
 * The derived day grid: one `AttendanceDay` per employee per date.
 *
 * Attendance status is computed on read, never stored. A row exists only
 * when something actually happened — a check-in, or an HR entry. Absence,
 * leave, holidays and weekly offs are derived here.
 *
 * The payoff is that retroactive changes fix themselves: HR approving last
 * Tuesday's sick leave silently re-labels that day ON_LEAVE instead of
 * ABSENT, with no backfill job and no window in which payroll would deduct
 * for a day that was granted.
 */

import type { Attendance, Holiday, LeaveSession, Shift } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { env } from "../../config/env"
import { addDays, formatDateOnly, parseDateOnly } from "../../utils/dates"
import { officeToday, shiftMidpoint, toMinutes } from "./attendance.time"
import type { AttendanceDay, AttendanceStatus, GridEmployee, ShiftInfo } from "./attendance.types"

/** The shift every employee falls back to when `shiftId` is null. */
export const DEFAULT_SHIFT_NAME = "General"

/**
 * The date attendance became the record of truth. Nothing derives before it.
 *
 * Without this floor, staff who joined years ago would show ABSENT for every
 * working day back to their joining date, because no rows exist for any of
 * them — the first monthly summary payroll ever saw would be wrong for the
 * entire company.
 */
export function goLiveDate(): Date {
  return parseDateOnly(env.ATTENDANCE_GO_LIVE)
}

export function shiftInfo(shift: Shift): ShiftInfo {
  return {
    id: shift.id,
    name: shift.name,
    startTime: shift.startTime,
    endTime: shift.endTime,
    breakMinutes: shift.breakMinutes,
    graceMinutes: shift.graceMinutes,
    weeklyOffDays: shift.weeklyOffDays,
    // Elapsed, break included. Nothing subtracts breakMinutes anywhere in
    // the payroll path — the break sits inside both the expectation and the
    // measurement, so elapsed-vs-elapsed compares correctly with no
    // arithmetic and no "what do you subtract from a 3-hour day?" case.
    expectedHours: Math.round(((toMinutes(shift.endTime) - toMinutes(shift.startTime)) / 60) * 100) / 100,
  }
}

function windowSpan(shift: Shift): number {
  if (!shift.effectiveFrom || !shift.effectiveTo) return Number.POSITIVE_INFINITY
  return shift.effectiveTo.getTime() - shift.effectiveFrom.getTime()
}

/**
 * The shift in force for an employee on a given date.
 *
 * A shift carrying a date window is a **company-wide override** for those
 * dates — which is exactly what Ramadan hours are, and it needs no
 * per-employee reassignment. The narrowest window wins, so a one-week
 * override beats a one-month one.
 *
 * Per-employee dated assignment (a `ShiftAssignment` join table) is the
 * upgrade path if departments ever diverge; it would be dead weight for one
 * shortened month a year.
 */
export function resolveShift(
  // Only `shiftId` is read. Narrow on purpose: three call sites resolve a
  // shift for a bare Attendance row and would otherwise have to invent a
  // joiningDate and an employmentStatus that no rule here consults.
  employee: Pick<GridEmployee, "shiftId">,
  date: Date,
  shifts: Shift[]
): Shift {
  let narrowest: Shift | undefined
  for (const shift of shifts) {
    if (!shift.effectiveFrom || !shift.effectiveTo) continue
    if (date < shift.effectiveFrom || date > shift.effectiveTo) continue
    if (!narrowest || windowSpan(shift) < windowSpan(narrowest)) narrowest = shift
  }
  if (narrowest) return narrowest

  if (employee.shiftId) {
    const assigned = shifts.find((s) => s.id === employee.shiftId)
    if (assigned) return assigned
  }

  const fallback = shifts.find((s) => s.name === DEFAULT_SHIFT_NAME)
  if (!fallback) {
    throw new Error(`No "${DEFAULT_SHIFT_NAME}" shift exists — run the seed before using attendance`)
  }
  return fallback
}

/**
 * The shift window an employee is actually expected for on a given date.
 *
 * A half-day leave narrows the window to the half they are *not* on leave
 * for. Returns a `Shift`-shaped value rather than a new type, so every
 * existing consumer — `shiftInfo`, `computeIsLate`, `computeIsEarlyOut` —
 * works on it unchanged. None of them learn about leave; they are simply
 * handed a different window.
 *
 * Substituting the input rather than adding a `leave` parameter to three
 * functions is what makes lateness, early-out and expected hours all come out
 * right from one change.
 *
 * `startSession` is the half that is *off*, not the half that is worked.
 */
export function effectiveShift(
  shift: Shift,
  leaveFraction: number,
  startSession: LeaveSession
): Shift {
  if (leaveFraction !== 0.5) return shift
  const mid = shiftMidpoint(shift)
  // The leave covers the first half, so work starts at the midpoint.
  return startSession === "FIRST_HALF" ? { ...shift, startTime: mid } : { ...shift, endTime: mid }
}

/** Inclusive list of calendar dates, as YYYY-MM-DD strings. */
export function eachDate(from: Date, to: Date): string[] {
  const dates: string[] = []
  for (let d = from; d.getTime() <= to.getTime(); d = addDays(d, 1)) {
    dates.push(formatDateOnly(d))
  }
  return dates
}

const key = (employeeId: string, date: string) => `${employeeId}|${date}`

interface GridSources {
  attendances: Attendance[]
  leaves: Array<{
    employeeId: string
    startDate: Date
    endDate: Date
    // Which half of each boundary date the leave covers. A whole-day request
    // is FIRST_HALF -> SECOND_HALF; anything else makes that boundary a half
    // day, which narrows the shift window and halves the day's charge.
    startSession: LeaveSession
    endSession: LeaveSession
    // `isPaid` rides along because payroll deducts for unpaid leave and must
    // not deduct for paid leave, and the grid is the only place that knows
    // which leave covered which day.
    leaveType: { name: string; isPaid: boolean }
  }>
  holidays: Holiday[]
  shifts: Shift[]
}

/**
 * Fetches everything the grid needs in a **fixed number of queries,
 * regardless of headcount**.
 *
 * The obvious implementation queries per employee per concern — leave for
 * Rahim, holidays for Rahim, attendance for Rahim, then the next person —
 * which is over a thousand round trips for 500 people on one monthly
 * summary. That cost would get blamed on the derived design when it is
 * really just the naive loop, so bulk fetching is a required characteristic
 * here, not an optimisation for later.
 */
export async function loadGridSources(
  employeeIds: string[],
  from: Date,
  to: Date
): Promise<GridSources> {
  const [attendances, leaves, holidays, shifts] = await Promise.all([
    prisma.attendance.findMany({
      where: { employeeId: { in: employeeIds }, date: { gte: from, lte: to } },
    }),
    prisma.leaveRequest.findMany({
      where: {
        employeeId: { in: employeeIds },
        status: "APPROVED",
        startDate: { lte: to },
        endDate: { gte: from },
      },
      select: {
        employeeId: true,
        startDate: true,
        endDate: true,
        startSession: true,
        endSession: true,
        leaveType: { select: { name: true, isPaid: true } },
      },
    }),
    prisma.holiday.findMany({ where: { date: { gte: from, lte: to } } }),
    prisma.shift.findMany(),
  ])

  return { attendances, leaves, holidays, shifts }
}

interface DateHolidays {
  /** Holidays that take the day off. */
  offNames: string[]
  /** A WORKING_DAY override cancels the weekly off for this date. */
  isWorkingDayOverride: boolean
}

function indexHolidays(holidays: Holiday[]): Map<string, DateHolidays> {
  const byDate = new Map<string, DateHolidays>()
  for (const holiday of holidays) {
    const date = formatDateOnly(holiday.date)
    const entry = byDate.get(date) ?? { offNames: [], isWorkingDayOverride: false }
    if (holiday.type === "WORKING_DAY") {
      entry.isWorkingDayOverride = true
    } else {
      // A date can legitimately carry two holidays — 2026-05-01 is both May
      // Day and Buddha Purnima — so names accumulate rather than overwrite.
      entry.offNames.push(holiday.name)
    }
    byDate.set(date, entry)
  }
  return byDate
}

interface LeaveOnDay {
  name: string
  isPaid: boolean
  /** 1 for a whole day, 0.5 when this date is a half boundary. */
  fraction: number
  /** Which half the leave *covers*, when `fraction` is 0.5. */
  startSession: LeaveSession
}

function indexLeaves(
  leaves: GridSources["leaves"],
  from: Date,
  to: Date
): Map<string, LeaveOnDay> {
  const byKey = new Map<string, LeaveOnDay>()
  for (const leave of leaves) {
    const start = leave.startDate < from ? from : leave.startDate
    const end = leave.endDate > to ? to : leave.endDate
    const startKey = formatDateOnly(leave.startDate)
    const endKey = formatDateOnly(leave.endDate)

    for (const date of eachDate(start, end)) {
      // Only the request's own boundary dates can be halves; interior dates
      // are always whole, whatever the sessions say.
      let fraction = 1
      if (date === startKey && leave.startSession === "SECOND_HALF") fraction -= 0.5
      if (date === endKey && leave.endSession === "FIRST_HALF") fraction -= 0.5

      byKey.set(key(leave.employeeId, date), {
        name: leave.leaveType.name,
        isPaid: leave.leaveType.isPaid,
        fraction,
        // The half that is *off*. `effectiveShift` reads it to decide which
        // end of the window to move.
        startSession:
          fraction === 0.5 && date === startKey && leave.startSession === "SECOND_HALF"
            ? "SECOND_HALF"
            : "FIRST_HALF",
      })
    }
  }
  return byKey
}

/**
 * Builds the grid from pre-fetched sources. Pure apart from `officeToday()`,
 * so the resolution rules can be tested without touching Prisma.
 */
export function resolveGrid(
  employees: GridEmployee[],
  from: Date,
  to: Date,
  sources: GridSources
): Map<string, AttendanceDay[]> {
  const dates = eachDate(from, to)
  const today = formatDateOnly(officeToday())
  const floor = formatDateOnly(goLiveDate())

  const attendanceByKey = new Map<string, Attendance>()
  for (const row of sources.attendances) {
    attendanceByKey.set(key(row.employeeId, formatDateOnly(row.date)), row)
  }
  const leaveByKey = indexLeaves(sources.leaves, from, to)
  const holidaysByDate = indexHolidays(sources.holidays)

  const grid = new Map<string, AttendanceDay[]>()

  for (const employee of employees) {
    const joined = formatDateOnly(employee.joiningDate)
    const hasLeft =
      employee.employmentStatus === "RESIGNED" || employee.employmentStatus === "TERMINATED"
    // lastWorkingDay is authoritative when set. Falling back to `today` is
    // the old behaviour, kept for a leaver whose exit date was never recorded
    // — it must not start reporting absences retroactively for them.
    //
    // Not cosmetic: settlement's pendingSalary reads this same grid, so
    // without the clip a leaver's final month would be computed over days
    // marked NOT_TRACKED that they actually worked.
    const exitBoundary = formatDateOnly(employee.lastWorkingDay ?? officeToday())

    const days: AttendanceDay[] = dates.map((date) => {
      const row = attendanceByKey.get(key(employee.id, date))
      const leave = leaveByKey.get(key(employee.id, date))
      // The leave is read first so the window can be narrowed before anything
      // is derived from it: expectedHours, and through it shortfallHours and
      // the SHORTFALL approval reason, all fall out of this one substitution.
      const shift = effectiveShift(
        resolveShift(employee, parseDateOnly(date), sources.shifts),
        leave?.fraction ?? 0,
        leave?.startSession ?? "FIRST_HALF"
      )
      const info = shiftInfo(shift)
      const holidayEntry = holidaysByDate.get(date)

      const isHoliday = (holidayEntry?.offNames.length ?? 0) > 0
      const weekday = parseDateOnly(date).getUTCDay()
      const isWeeklyOff =
        shift.weeklyOffDays.includes(weekday) && !holidayEntry?.isWorkingDayOverride
      const isOffDay = isHoliday || isWeeklyOff

      const beforeTracking = date < floor || date < joined
      // With an exit date: tracked up to and *including* it, since the last
      // working day is worked. Without one: `>= today`, the old rule, where
      // somebody already flagged as left does not appear on today's board as
      // "not checked in yet" either.
      const afterLeaving =
        hasLeft && (employee.lastWorkingDay ? date > exitBoundary : date >= exitBoundary)

      // Precedence, first match wins. Each position is load-bearing:
      // a check-in beats a holiday because physical facts beat records,
      // and blocking a holiday check-in would leave someone who genuinely
      // came in unable to record real work.
      let status: AttendanceStatus
      let detail: string | null = null

      if (beforeTracking || afterLeaving) {
        status = "NOT_TRACKED"
      } else if (row && row.approval !== "REJECTED") {
        status = "PRESENT"
        detail = isHoliday ? (holidayEntry?.offNames.join(" · ") ?? null) : null
      } else if (leave) {
        status = "ON_LEAVE"
        detail = leave.name
      } else if (isHoliday) {
        status = "HOLIDAY"
        detail = holidayEntry?.offNames.join(" · ") ?? null
      } else if (isWeeklyOff) {
        status = "WEEKLY_OFF"
      } else if (date < today) {
        // A rejected record lands here: it is not an attendance.
        status = "ABSENT"
      } else {
        // Today or later. Calling this ABSENT would report the whole
        // company absent at 10am.
        status = "NOT_CHECKED_IN"
      }

      const isWorkingDay = status !== "NOT_TRACKED" && !isOffDay

      return {
        date,
        status,
        isWorkingDay,
        isOffDay,
        isHoliday,
        isWeeklyOff,
        checkIn: row?.checkIn?.toISOString() ?? null,
        checkOut: row?.checkOut?.toISOString() ?? null,
        workedHours: row?.workedHours ?? null,
        expectedHours: isWorkingDay ? info.expectedHours : 0,
        isLate: row?.isLate ?? false,
        isEarlyOut: row?.isEarlyOut ?? false,
        approval: row?.approval ?? null,
        source: row?.source ?? null,
        detail,
        // Only meaningful on an ON_LEAVE day. A day someone checked in on
        // while leave was approved is PRESENT, not leave, so it must not
        // report a paid-leave flag payroll would then act on.
        leaveIsPaid: status === "ON_LEAVE" ? (leave?.isPaid ?? null) : null,
        leaveFraction: leave?.fraction ?? 0,
        // Already normalised by `indexLeaves` to the half that is *off*, so
        // a consumer can hand it straight to `effectiveShift`.
        leaveStartSession: leave?.startSession ?? null,
        // Only meaningful for a partial leave nobody punched for. The
        // past/future rule is the same one the ABSENT / NOT_CHECKED_IN split
        // above uses, so the two can never disagree.
        unservedStatus:
          leave && leave.fraction < 1 && !row ? (date < today ? "ABSENT" : "NOT_CHECKED_IN") : null,
        regularised: row?.regularisedAt != null,
        // The employee needs to know this even more than the approver does:
        // it is the only signal that a time they never punched is sitting on
        // their record, and only they can say whether it is right.
        autoCheckOut: row?.autoCheckOutAt != null,
        corrected: row?.correctedAt != null,
        attendanceId: row?.id ?? null,
      }
    })

    grid.set(employee.id, days)
  }

  return grid
}

/** Loads sources and resolves the grid. The entry point for every read. */
export async function buildDayGrid(
  employees: GridEmployee[],
  from: Date,
  to: Date
): Promise<Map<string, AttendanceDay[]>> {
  if (employees.length === 0) return new Map()
  const sources = await loadGridSources(
    employees.map((e) => e.id),
    from,
    to
  )
  return resolveGrid(employees, from, to, sources)
}
