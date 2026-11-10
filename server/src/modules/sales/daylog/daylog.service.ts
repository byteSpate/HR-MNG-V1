/**
 * Collects one person's work log and draws it (owner, 2026-11-10).
 *
 * Always the caller's own log. The owner asked for no admin view here: each
 * person makes the picture of their own day and shows it.
 *
 * What counts for a day, in office time:
 * - a task they finished, on the day it was marked done (as on the Logs tab)
 * - a meeting they went to for our side, marked held, on the day it was held
 * - an Opportunity they own, closed Won, Lost or Cancelled, on the day it closed
 */

import prisma from "../../../config/prisma"
import { env } from "../../../config/env"
import { addDays, formatDateOnly, parseDateOnly } from "../../../utils/dates"
import { brandAsset, renderPng } from "../../../utils/pdf"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { officeDateOf, officeInstantOf, officeTimeOf } from "../../attendance/attendance.time"
import { formatBdt } from "../../accounting/accounting.utils"
import { employeeIdFor } from "../sales.access"
import { AppError } from "../../../middleware/errorHandler"
import { buildDays, paginate, renderDayLogHtml, type DayLog, type DayLogDay } from "./daylog.render"
import type { DayLogQuery } from "./daylog.validators"

/** The picture's width in CSS pixels. Wide enough for a laptop, readable on a phone. */
const WIDTH = 820

/** A day's list, so a busy day cannot make an endless picture. */
const LIMIT = 300

type Filled = Omit<DayLogDay, "date">

export async function getDayLog(query: DayLogQuery, actor: AccessTokenPayload): Promise<DayLog> {
  const employeeId = await employeeIdFor(actor)
  const start = officeInstantOf(parseDateOnly(query.from), "00:00")
  const end = officeInstantOf(addDays(parseDateOnly(query.to), 1), "00:00")
  const window = { gte: start, lt: end }

  // No Employee record (a Super Admin with no staff file) means nothing is
  // theirs. An empty log is the honest answer.
  const [person, tasks, meetings, closes] = employeeId
    ? await Promise.all([
        prisma.employee.findUnique({ where: { id: employeeId }, select: { fullName: true } }),
        prisma.salesTask.findMany({
          where: { assignedToEmployeeId: employeeId, status: "DONE", completedAt: window },
          select: {
            title: true,
            type: true,
            detail: true,
            outcome: true,
            completedAt: true,
            salesAccount: { select: { name: true } },
            opportunity: { select: { serial: true } },
          },
          orderBy: { completedAt: "asc" },
          take: LIMIT,
        }),
        prisma.salesMeeting.findMany({
          where: {
            status: "COMPLETED",
            scheduledAt: window,
            attendees: { some: { side: "OURS", employeeId } },
          },
          select: {
            title: true,
            scheduledAt: true,
            outcome: true,
            salesAccount: { select: { name: true } },
            opportunity: { select: { serial: true } },
          },
          orderBy: { scheduledAt: "asc" },
          take: LIMIT,
        }),
        prisma.opportunity.findMany({
          where: {
            ownerEmployeeId: employeeId,
            status: { in: ["WON", "LOST", "CANCELLED"] },
            closedAt: window,
          },
          select: {
            serial: true,
            name: true,
            amount: true,
            status: true,
            statusReason: true,
            closedAt: true,
            salesAccount: { select: { name: true } },
          },
          orderBy: { closedAt: "asc" },
          take: LIMIT,
        }),
      ])
    : [null, [], [], []]

  const filled = new Map<string, Filled>()
  const dayOf = (date: string) => {
    const existing = filled.get(date)
    if (existing) return existing
    const fresh: Filled = { tasks: [], meetings: [], closed: [] }
    filled.set(date, fresh)
    return fresh
  }
  const officeDay = (instant: Date) => formatDateOnly(officeDateOf(instant))

  for (const task of tasks) {
    dayOf(officeDay(task.completedAt!)).tasks.push({
      title: task.title,
      type: task.type,
      about: [task.salesAccount?.name, task.opportunity?.serial].filter(Boolean).join(" · ") || null,
      detail: task.detail,
      outcome: task.outcome,
    })
  }
  for (const meeting of meetings) {
    dayOf(officeDay(meeting.scheduledAt)).meetings.push({
      time: officeTimeOf(meeting.scheduledAt),
      title: meeting.title,
      accountName: meeting.salesAccount.name,
      opportunitySerial: meeting.opportunity?.serial ?? null,
      outcome: meeting.outcome,
    })
  }
  for (const close of closes) {
    dayOf(officeDay(close.closedAt!)).closed.push({
      status: close.status as "WON" | "LOST" | "CANCELLED",
      serial: close.serial,
      name: close.name,
      accountName: close.salesAccount.name,
      amount: close.amount ? formatBdt(close.amount) : null,
      reason: close.statusReason,
    })
  }

  return {
    personName: person?.fullName ?? actor.email,
    from: query.from,
    to: query.to,
    days: buildDays(query.from, query.to, filled),
  }
}

/** How many pictures the log needs. Cheap: three reads, no browser. */
export async function countDayLogPictures(query: DayLogQuery, actor: AccessTokenPayload): Promise<{ pictures: number }> {
  return { pictures: paginate((await getDayLog(query, actor)).days).length }
}

export async function renderDayLogPng(
  query: DayLogQuery,
  actor: AccessTokenPayload,
  picture: number
): Promise<Buffer> {
  const log = await getDayLog(query, actor)
  const count = paginate(log.days).length
  if (picture > count) {
    // The log got shorter between the count and this picture (a task deleted).
    throw new AppError(404, `This log has ${count} picture${count === 1 ? "" : "s"} now. Press Preview log again.`)
  }
  const html = renderDayLogHtml(
    log,
    {
      companyName: env.COMPANY_NAME,
      logo: await brandAsset("logo"),
      madeOn: formatDateOnly(officeDateOf(new Date())),
    },
    picture
  )
  return renderPng(html, WIDTH)
}
