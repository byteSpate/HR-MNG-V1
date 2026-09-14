/**
 * Who gets the 00:01 Sales Hub email, and what is in it (revision §24.14-16).
 * Pure: the job reads the rows and sends; this decides.
 *
 * One email per person, their meetings and their tasks together. Nobody with
 * nothing on gets one, because an empty email every day teaches people to
 * ignore the real ones. Nobody gets one on their weekly off day or a company
 * holiday; overdue tasks are in every email until they are closed, so what
 * fell due on a day off arrives on the next working day.
 */

import type { Shift } from "../../generated/prisma/client"
import { resolveShift } from "../attendance/attendance.grid"

export interface ReminderPerson {
  id: string
  fullName: string
  email: string | null
  shiftId: string | null
  /** Can still work in the hub: a sales role, a working login, still employed. */
  active: boolean
}

export interface ReminderMeeting {
  id: string
  title: string
  scheduledAt: Date
  mode: string
  location: string | null
  salesAccountName: string
  /** Our side only. Their side are customers, and this is not their email. */
  attendeeIds: string[]
}

export interface ReminderTask {
  id: string
  title: string
  dueOn: Date
  priority: string
  salesAccountName: string | null
  assignedToEmployeeId: string
}

export interface DailyDigest {
  employeeId: string
  fullName: string
  email: string
  meetings: ReminderMeeting[]
  tasks: (ReminderTask & { overdue: boolean })[]
}

export interface HolidayRow {
  date: Date
  type: string
}

/**
 * Read the way the attendance calendar reads it: any holiday on the date
 * takes the day off, an optional one included, and a WORKING_DAY row cancels
 * the weekly off for that date only.
 */
export function isWorkingDay(date: Date, shift: Pick<Shift, "weeklyOffDays">, holidays: HolidayRow[]): boolean {
  const onDate = holidays.filter((holiday) => holiday.date.getTime() === date.getTime())
  if (onDate.some((holiday) => holiday.type !== "WORKING_DAY")) return false
  const declaredWorking = onDate.some((holiday) => holiday.type === "WORKING_DAY")
  return declaredWorking || !shift.weeklyOffDays.includes(date.getUTCDay())
}

export function buildDailyDigests(input: {
  /** The office date the email is for, at UTC midnight. */
  today: Date
  people: ReminderPerson[]
  meetings: ReminderMeeting[]
  tasks: ReminderTask[]
  shifts: Shift[]
  holidays: HolidayRow[]
  /** People who already have a SALES_DAILY_EMAIL row today. */
  alreadySent: Set<string>
}): DailyDigest[] {
  const digests: DailyDigest[] = []
  for (const person of input.people) {
    if (!person.active || !person.email || input.alreadySent.has(person.id)) continue

    const meetings = input.meetings.filter((meeting) => meeting.attendeeIds.includes(person.id))
    const tasks = input.tasks
      .filter((task) => task.assignedToEmployeeId === person.id)
      .map((task) => ({ ...task, overdue: task.dueOn.getTime() < input.today.getTime() }))
    if (meetings.length === 0 && tasks.length === 0) continue

    const shift = resolveShift({ shiftId: person.shiftId }, input.today, input.shifts)
    if (!isWorkingDay(input.today, shift, input.holidays)) continue

    digests.push({ employeeId: person.id, fullName: person.fullName, email: person.email, meetings, tasks })
  }
  return digests
}
