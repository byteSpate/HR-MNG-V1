/**
 * The week rules behind the Weekly Report (revision §26.2 to §26.5, §26.12).
 *
 * Pure: every row these need is passed in, so the services, the reminder job
 * and the PDF all answer "which days, which deadline, was it late" the same
 * way, and the answers can be tested without a database.
 *
 * Every date here is date-only at UTC midnight, the convention leave and
 * attendance already follow. The one exception is an instant being judged
 * late, which is read through the office timezone rather than off UTC.
 */

import type { Shift } from "../../../generated/prisma/client"
import { addDays, formatDateOnly } from "../../../utils/dates"
import { officeDateOf } from "../../attendance/attendance.time"
import { isWorkingDay, type HolidayRow } from "../sales.reminders"

const SUNDAY = 0
const THURSDAY = 4
const SATURDAY = 6

/** Sunday to Thursday: the five days a week always has (§26.2). */
export const WEEK_DAY_COUNT = 5

/** A holiday, with the name a labelled day prints. */
export interface WeeklyHoliday extends HolidayRow {
  name: string
}

/** An approved leave request, as much of it as a day label reads. */
export interface LeaveWindow {
  startDate: Date
  endDate: Date
  startSession: string
  endSession: string
}

export interface DayLabel {
  kind: "HOLIDAY" | "WEEKLY_OFF" | "LEAVE" | "OUTSIDE_EMPLOYMENT"
  text: string
}

export interface DayLabelContext {
  shift: Pick<Shift, "weeklyOffDays">
  holidays: WeeklyHoliday[]
  leaves: LeaveWindow[]
  joiningDate: Date
  lastWorkingDay: Date | null
}

const sameDay = (a: Date, b: Date) => a.getTime() === b.getTime()
const covers = (window: LeaveWindow, date: Date) =>
  window.startDate.getTime() <= date.getTime() && date.getTime() <= window.endDate.getTime()

/**
 * The Sunday the given date's week starts on.
 *
 * A Saturday counts as the week it *opens*, not the one that just ended: the
 * team's sheets run "5 Sep to 10 Sep", with Saturday's office work at the top
 * (§26.2). Friday, which nobody works, stays with the week just ended, so a
 * Friday never opens a week of its own.
 */
export function weekStartOf(date: Date): Date {
  const weekday = date.getUTCDay()
  if (weekday === SATURDAY) return addDays(date, 1)
  return addDays(date, -weekday)
}

/** Sunday to Thursday. */
export function weekDays(weekStart: Date): Date[] {
  return Array.from({ length: WEEK_DAY_COUNT }, (_, i) => addDays(weekStart, i))
}

/** The optional Saturday before the week (§26.2). */
export function saturdayBefore(weekStart: Date): Date {
  return addDays(weekStart, -1)
}

/** The Thursday the week ends on. */
export function weekEndOf(weekStart: Date): Date {
  return addDays(weekStart, THURSDAY)
}

/** Saturday through Thursday. A date outside it cannot be written to. */
export function isInWeek(date: Date, weekStart: Date): boolean {
  return (
    saturdayBefore(weekStart).getTime() <= date.getTime() &&
    date.getTime() <= weekEndOf(weekStart).getTime()
  )
}

/**
 * The day a report is due: the Thursday, or the last working day before it
 * when the Thursday is a holiday (§26.3). Nobody is marked late for a day the
 * office was shut.
 *
 * A week with no working day at all falls back to the Thursday, so the
 * deadline is always a real date inside the week.
 */
export function deadlineDayOf(
  weekStart: Date,
  shift: Pick<Shift, "weeklyOffDays">,
  holidays: HolidayRow[]
): Date {
  for (let i = THURSDAY; i >= SUNDAY; i--) {
    const date = addDays(weekStart, i)
    if (isWorkingDay(date, shift, holidays)) return date
  }
  return weekEndOf(weekStart)
}

/**
 * Whether a submission missed the deadline.
 *
 * "Midnight Thursday" is the end of the office day, so the instant is read
 * through `officeDateOf` rather than off UTC: 23:30 in Dhaka on Thursday is
 * already Friday in UTC, and reading it there would mark an on-time report
 * late for everyone.
 */
export function isLate(submittedAt: Date, deadlineDay: Date): boolean {
  return officeDateOf(submittedAt).getTime() > deadlineDay.getTime()
}

/**
 * Why a day has nothing on it, when that is not the person's doing (§26.12).
 * Null means an ordinary working day, where an empty day is just an empty day.
 *
 * A holiday wins over leave: the office was shut anyway, and printing "On
 * leave" for Eid would read as though the person chose to be away.
 */
export function dayLabelOf(date: Date, context: DayLabelContext): DayLabel | null {
  if (date.getTime() < context.joiningDate.getTime()) {
    return { kind: "OUTSIDE_EMPLOYMENT", text: "Before joining" }
  }
  if (context.lastWorkingDay && date.getTime() > context.lastWorkingDay.getTime()) {
    return { kind: "OUTSIDE_EMPLOYMENT", text: "After leaving" }
  }

  const key = formatDateOnly(date)
  const named = context.holidays.find(
    (holiday) => formatDateOnly(holiday.date) === key && holiday.type !== "WORKING_DAY"
  )
  if (named) return { kind: "HOLIDAY", text: named.name }

  if (!isWorkingDay(date, context.shift, context.holidays)) {
    return { kind: "WEEKLY_OFF", text: "Weekly off" }
  }

  const leave = context.leaves.find((window) => covers(window, date))
  if (leave) return { kind: "LEAVE", text: `On leave${halfOf(leave, date)}` }

  return null
}

/** " (second half)" when the leave covers only half of this day. */
function halfOf(leave: LeaveWindow, date: Date): string {
  if (sameDay(leave.startDate, date) && leave.startSession === "SECOND_HALF") {
    return " (second half)"
  }
  if (sameDay(leave.endDate, date) && leave.endSession === "FIRST_HALF") {
    return " (first half)"
  }
  return ""
}
