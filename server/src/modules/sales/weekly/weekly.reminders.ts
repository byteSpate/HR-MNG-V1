/**
 * Who gets the weekly report reminder, and when (revision §26.3).
 *
 * Pure: the job reads the rows and sends; this decides. One email per person
 * per week, on their own deadline day — the Thursday, or the last working day
 * before it when the Thursday is a holiday, because nobody should be chased
 * on a day the office was shut.
 */

import type { Shift } from "../../../generated/prisma/client"
import { resolveShift } from "../../attendance/attendance.grid"
import type { HolidayRow } from "../sales.reminders"
import { deadlineDayOf, weekStartOf } from "./weekly.dates"

export interface ReminderPerson {
  id: string
  fullName: string
  email: string | null
  shiftId: string | null
  /** Can still work in the hub: a sales role, a working login, still employed. */
  active: boolean
}

export interface ReminderReport {
  employeeId: string
  weekStart: Date
  status: string
}

export interface ReminderInput {
  /** Today's office date, at UTC midnight. */
  today: Date
  people: ReminderPerson[]
  shifts: Shift[]
  holidays: HolidayRow[]
  reports: ReminderReport[]
  /** People who already have a SALES_WEEKLY_REMINDER row for this week. */
  alreadySent: Set<string>
}

export interface WeeklyReminder {
  employeeId: string
  fullName: string
  email: string
  weekStart: Date
  deadlineDay: Date
}

/** The people whose week is due today and is not submitted. */
export function whoNeedsReminding(input: ReminderInput): WeeklyReminder[] {
  const weekStart = weekStartOf(input.today)
  const reminders: WeeklyReminder[] = []

  for (const person of input.people) {
    if (!person.active || !person.email || input.alreadySent.has(person.id)) continue

    const shift = resolveShift({ shiftId: person.shiftId }, input.today, input.shifts)
    const deadlineDay = deadlineDayOf(weekStart, shift, input.holidays)
    if (deadlineDay.getTime() !== input.today.getTime()) continue

    const report = input.reports.find(
      (row) => row.employeeId === person.id && row.weekStart.getTime() === weekStart.getTime()
    )
    if (report?.status === "SUBMITTED") continue

    reminders.push({
      employeeId: person.id,
      fullName: person.fullName,
      email: person.email,
      weekStart,
      deadlineDay,
    })
  }
  return reminders
}
