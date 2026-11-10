/**
 * Time reminders: notifications nobody clicked a button to cause.
 *
 * Each is Important, has no event, and carries a `dedupeKey`, so a job that
 * runs twice (a restart, two dynos) writes one row. Each is filed under the
 * thing it is about (`entity`/`entityId`), so the decision that ends that
 * thing closes the reminder too: an approved leave closes its "still
 * waiting" reminder, an accepted asset closes "please accept".
 *
 * Every function takes `now` so the tests can fix the clock.
 */

import prisma from "../../config/prisma"
import { addDays } from "../../utils/dates"
import { resolveShift } from "../attendance/attendance.grid"
import { officeDateOf, officeTimeOf } from "../attendance/attendance.time"
import { formatLeaveRange } from "../leave/leave.events"
import { isWorkingDay } from "../sales/sales.reminders"
import { REQUEST_KINDS } from "./inbox.rules"

const HOUR = 3_600_000

interface Reminder {
  userId: string
  kind: string
  entity: string
  entityId: string
  title: string
  meta: string | null
  href: string | null
  dedupeKey: string
}

/** Drops inactive users, then writes once per key. Returns rows offered. */
async function write(reminders: Reminder[]): Promise<number> {
  if (reminders.length === 0) return 0
  const active = await prisma.user.findMany({
    where: { id: { in: [...new Set(reminders.map((r) => r.userId))] }, isActive: true },
    select: { id: true },
  })
  const ok = new Set(active.map((u) => u.id))
  const rows = reminders.filter((r) => ok.has(r.userId))
  if (rows.length === 0) return 0
  await prisma.notification.createMany({
    data: rows.map((r) => ({ ...r, tab: "IMPORTANT" as const })),
    skipDuplicates: true,
  })
  return rows.length
}

/** Every 5 minutes: meetings that start in the next 30 minutes. */
export async function remindMeetingsSoon(now: Date = new Date()): Promise<number> {
  const meetings = await prisma.salesMeeting.findMany({
    where: { status: "SCHEDULED", scheduledAt: { gt: now, lte: new Date(now.getTime() + 30 * 60_000) } },
    select: {
      id: true,
      title: true,
      scheduledAt: true,
      salesAccountId: true,
      attendees: {
        where: { side: "OURS", employeeId: { not: null } },
        select: { employee: { select: { userId: true } } },
      },
    },
  })

  return write(
    meetings.flatMap((m) =>
      m.attendees.flatMap((a) =>
        a.employee
          ? [
              {
                userId: a.employee.userId,
                kind: "reminder.meeting_30min",
                entity: "SALES_MEETING",
                entityId: m.id,
                title: "Your meeting starts in 30 minutes",
                meta: `${m.title} · ${officeTimeOf(m.scheduledAt)}`,
                href: `/accounts/${m.salesAccountId}`,
                // The time is in the key: a moved meeting is reminded again.
                dedupeKey: `meeting-30min:${m.id}:${m.scheduledAt.toISOString()}:${a.employee.userId}`,
              },
            ]
          : []
      )
    )
  )
}

/** Morning: tasks due today, and tasks that became late yesterday. */
export async function remindTasksDueAndLate(now: Date = new Date()): Promise<number> {
  const today = officeDateOf(now)
  const yesterday = addDays(today, -1)

  const [tasks, shifts, holidays] = await Promise.all([
    prisma.salesTask.findMany({
      where: { status: "PENDING", dueOn: { in: [today, yesterday] } },
      select: { id: true, title: true, dueOn: true, assignedTo: { select: { userId: true, shiftId: true } } },
    }),
    prisma.shift.findMany(),
    prisma.holiday.findMany({ where: { date: today } }),
  ])

  const reminders: Reminder[] = []
  for (const task of tasks) {
    const shift = resolveShift({ shiftId: task.assignedTo.shiftId }, today, shifts)
    if (!isWorkingDay(today, shift, holidays)) continue
    const due = task.dueOn.getTime() === today.getTime()
    reminders.push({
      userId: task.assignedTo.userId,
      kind: due ? "reminder.task_due" : "reminder.task_late",
      entity: "SALES_TASK",
      entityId: task.id,
      title: due ? "Task due today" : "Task is late",
      meta: task.title,
      href: "/tasks",
      dedupeKey: `${due ? "task-due" : "task-late"}:${task.id}`,
    })
  }
  return write(reminders)
}

/** 21:30: people still checked in, before the 22:05 automatic check-out. */
export async function remindNotCheckedOut(now: Date = new Date()): Promise<number> {
  const open = await prisma.attendance.findMany({
    where: { date: officeDateOf(now), checkIn: { not: null }, checkOut: null },
    select: { id: true, employee: { select: { userId: true } } },
  })
  return write(
    open.map((a) => ({
      userId: a.employee.userId,
      kind: "reminder.not_checked_out",
      entity: "ATTENDANCE",
      entityId: a.id,
      title: "You have not checked out yet",
      meta: "Check out before 10:05 PM, or the app will do it for you.",
      href: "/attendance",
      dedupeKey: `checkout-today:${a.id}`,
    }))
  )
}

/**
 * Morning: requests still open after 2 days.
 *
 * Read from the approvers' own open rows rather than from each module's
 * tables, so the approver rule stays in `inbox.rules.ts` only, and a request
 * someone already decided (row closed) is skipped for free.
 */
export async function remindWaitingTwoDays(now: Date = new Date()): Promise<number> {
  const waiting = await prisma.notification.findMany({
    where: {
      tab: "IMPORTANT",
      kind: { in: [...REQUEST_KINDS] },
      eventId: { not: null },
      closedAt: null,
      createdAt: { lte: new Date(now.getTime() - 48 * HOUR) },
    },
    select: { userId: true, entity: true, entityId: true, title: true, href: true },
  })
  return write(
    waiting.map((w) => ({
      userId: w.userId,
      kind: "reminder.waiting_2d",
      entity: w.entity,
      entityId: w.entityId,
      title: "Still waiting for your answer",
      meta: w.title,
      href: w.href,
      dedupeKey: `waiting-2d:${w.entity}:${w.entityId}:${w.userId}`,
    }))
  )
}

/** Morning: an asset handed over a day ago and not yet accepted. */
export async function remindAssetsNotAccepted(now: Date = new Date()): Promise<number> {
  const open = await prisma.assetAssignment.findMany({
    where: { acknowledgedAt: null, returnedAt: null, assignedAt: { lte: new Date(now.getTime() - 24 * HOUR) } },
    select: {
      id: true,
      assetId: true,
      asset: { select: { name: true, assetTag: true } },
      employee: { select: { userId: true } },
    },
  })
  return write(
    open.map((a) => ({
      userId: a.employee.userId,
      kind: "reminder.asset_accept",
      // Under ASSET, like `asset.assigned`, so accepting closes both.
      entity: "ASSET",
      entityId: a.assetId,
      title: "Please accept your asset",
      meta: `${a.asset.assetTag} · ${a.asset.name}`,
      href: "/assets",
      dedupeKey: `asset-accept:${a.id}`,
    }))
  )
}

/** Morning: tell a manager whose team member starts approved leave tomorrow. */
export async function remindLeaveTomorrow(now: Date = new Date()): Promise<number> {
  const leaves = await prisma.leaveRequest.findMany({
    where: { status: "APPROVED", startDate: addDays(officeDateOf(now), 1) },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      employee: { select: { fullName: true, reportingManager: { select: { userId: true } } } },
    },
  })
  return write(
    leaves.flatMap((l) =>
      l.employee.reportingManager
        ? [
            {
              userId: l.employee.reportingManager.userId,
              kind: "reminder.leave_tomorrow",
              entity: "LEAVE_REQUEST",
              entityId: l.id,
              title: `${l.employee.fullName} starts leave tomorrow`,
              meta: formatLeaveRange(l.startDate, l.endDate),
              href: "/leave",
              dedupeKey: `leave-tomorrow:${l.id}`,
            },
          ]
        : []
    )
  )
}
