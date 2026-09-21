/**
 * The weekly report reminder, at 16:00 on the day it is due (revision §26.3).
 *
 * Reads the week's rows and hands them to `whoNeedsReminding`, which decides
 * who gets one. Exported apart from its schedule, like the other jobs, so it
 * can be run by hand or in a test.
 *
 * Safe to run twice: anybody who already has a SALES_WEEKLY_REMINDER row for
 * this week is skipped.
 */

import prisma from "../config/prisma"
import { officeDateOf, officeInstantOf } from "../modules/attendance/attendance.time"
import { standingOf } from "../modules/sales/accounts/account.service"
import { canWorkAccounts } from "../modules/sales/sales.eligibility"
import { sendWeeklyReminder } from "../modules/sales/sales.mailer"
import { whoNeedsReminding } from "../modules/sales/weekly/weekly.reminders"
import { saturdayBefore, weekEndOf, weekStartOf } from "../modules/sales/weekly/weekly.dates"

export async function runWeeklyReportReminder(now: Date = new Date()): Promise<number> {
  const today = officeDateOf(now)
  const weekStart = weekStartOf(today)

  const [people, shifts, holidays, reports, sent] = await Promise.all([
    // Only Sales Users write a weekly report (§26.1).
    prisma.employee.findMany({
      where: { user: { salesRole: "SALES_USER" } },
      select: {
        id: true,
        fullName: true,
        shiftId: true,
        employmentStatus: true,
        lastWorkingDay: true,
        user: { select: { email: true, salesRole: true, isActive: true } },
      },
    }),
    prisma.shift.findMany(),
    prisma.holiday.findMany({
      where: { date: { gte: saturdayBefore(weekStart), lte: weekEndOf(weekStart) } },
      select: { date: true, type: true },
    }),
    prisma.weeklyReport.findMany({
      where: { weekStart },
      select: { employeeId: true, weekStart: true, status: true },
    }),
    prisma.emailDispatch.findMany({
      where: { kind: "SALES_WEEKLY_REMINDER", createdAt: { gte: officeInstantOf(weekStart, "00:00") } },
      select: { entityId: true },
    }),
  ])

  const reminders = whoNeedsReminding({
    today,
    people: people.map((person) => ({
      id: person.id,
      fullName: person.fullName,
      email: person.user?.email ?? null,
      shiftId: person.shiftId,
      active: canWorkAccounts(standingOf(person), now),
    })),
    shifts,
    holidays,
    reports,
    alreadySent: new Set(sent.flatMap((row) => (row.entityId ? [row.entityId] : []))),
  })

  for (const reminder of reminders) {
    await sendWeeklyReminder(reminder)
  }
  return reminders.length
}
