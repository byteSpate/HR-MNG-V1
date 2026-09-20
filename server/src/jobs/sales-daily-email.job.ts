/**
 * The Sales Hub's 00:01 email (revision §24.14).
 *
 * Reads the day's rows and hands them to `buildDailyDigests`, which decides
 * who gets what. Exported apart from its schedule, like the attendance jobs,
 * so it can be run by hand or in a test.
 *
 * Safe to run twice: anybody who already has a SALES_DAILY_EMAIL row for the
 * day is skipped, so a restart at 00:02 sends nothing new.
 */

import prisma from "../config/prisma"
import { officeDateOf, officeInstantOf } from "../modules/attendance/attendance.time"
import { standingOf } from "../modules/sales/accounts/account.service"
import { canWorkAccounts } from "../modules/sales/sales.eligibility"
import { sendSalesDailyEmail } from "../modules/sales/sales.mailer"
import { buildDailyDigests } from "../modules/sales/sales.reminders"
import { addDays } from "../utils/dates"

export async function runSalesDailyEmail(now: Date = new Date()): Promise<number> {
  const today = officeDateOf(now)
  const dayStart = officeInstantOf(today, "00:00")
  const dayEnd = officeInstantOf(addDays(today, 1), "00:00")

  const [meetings, tasks, shifts, holidays, sent] = await Promise.all([
    // A cancelled meeting is simply not found.
    prisma.salesMeeting.findMany({
      where: { status: "SCHEDULED", scheduledAt: { gte: dayStart, lt: dayEnd } },
      select: {
        id: true,
        title: true,
        scheduledAt: true,
        mode: true,
        location: true,
        salesAccount: { select: { name: true } },
        attendees: { where: { side: "OURS" }, select: { employeeId: true } },
      },
      orderBy: { scheduledAt: "asc" },
    }),
    // Due today or before: an overdue task is in every email until it is closed.
    prisma.salesTask.findMany({
      where: { status: "PENDING", dueOn: { lte: today } },
      select: {
        id: true,
        title: true,
        dueOn: true,
        priority: true,
        assignedToEmployeeId: true,
        salesAccount: { select: { name: true } },
      },
      orderBy: [{ dueOn: "asc" }, { priority: "desc" }],
    }),
    prisma.shift.findMany(),
    prisma.holiday.findMany({ where: { date: today } }),
    prisma.emailDispatch.findMany({
      where: { kind: "SALES_DAILY_EMAIL", createdAt: { gte: dayStart } },
      select: { entityId: true },
    }),
  ])

  const ids = new Set<string>([
    ...meetings.flatMap((meeting) => meeting.attendees.flatMap((a) => (a.employeeId ? [a.employeeId] : []))),
    ...tasks.map((task) => task.assignedToEmployeeId),
  ])
  if (ids.size === 0) return 0

  const people = await prisma.employee.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true,
      fullName: true,
      shiftId: true,
      employmentStatus: true,
      lastWorkingDay: true,
      user: { select: { email: true, salesRole: true, isActive: true } },
    },
  })

  const digests = buildDailyDigests({
    today,
    people: people.map((person) => ({
      id: person.id,
      fullName: person.fullName,
      email: person.user?.email ?? null,
      shiftId: person.shiftId,
      active: canWorkAccounts(standingOf(person), now),
    })),
    meetings: meetings.map((meeting) => ({
      id: meeting.id,
      title: meeting.title,
      scheduledAt: meeting.scheduledAt,
      mode: meeting.mode,
      location: meeting.location,
      salesAccountName: meeting.salesAccount.name,
      attendeeIds: meeting.attendees.flatMap((a) => (a.employeeId ? [a.employeeId] : [])),
    })),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      dueOn: task.dueOn,
      priority: task.priority,
      salesAccountName: task.salesAccount?.name ?? null,
      assignedToEmployeeId: task.assignedToEmployeeId,
    })),
    shifts,
    holidays,
    alreadySent: new Set(sent.flatMap((row) => (row.entityId ? [row.entityId] : []))),
  })

  for (const digest of digests) {
    await sendSalesDailyEmail(digest, today)
  }
  return digests.length
}
