import prisma from "../../../config/prisma"
import { SalesRole } from "../../../generated/prisma/client"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import { parseDateOnly } from "../../../utils/dates"
import { officeToday } from "../../attendance/attendance.time"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { employeeIdFor } from "../sales.access"
import { weekStartOf } from "../sales.week"
import type { SaveProjectLogBody } from "./project.validators"

const NOT_ON_TEAM = "That Project does not exist, or you are not on its team"
const LOG_NOT_FOUND = "That line does not exist, or is not yours"
const NOT_A_WRITER = "Only a Sales User writes a Daily Log"
const NO_EMPLOYEE = "A Daily Log belongs to an employee, and your login has no employee record"
const FUTURE_DAY = "Choose a day that is today or earlier."

/** The writer: a Sales User with an employee record, and nobody else. */
async function writerFor(actor: AccessTokenPayload): Promise<string> {
  if (actor.salesRole !== SalesRole.SALES_USER) throw new AppError(403, NOT_A_WRITER)
  const employeeId = await employeeIdFor(actor)
  if (!employeeId) throw new AppError(400, NO_EMPLOYEE)
  return employeeId
}

/**
 * One Daily Log line (spec §2.2): what I did on this Project that day, or that
 * I did no work on it. A person writes only for Projects whose team they are
 * on, and for any day up to today. There is no "open week" rule any more: the
 * Weekly Report is retired (owner, 2026-11-02), so nothing closes a week.
 *
 * A line still hangs off a week row (`WeeklyReport`), which is only its
 * container now: it is made on the first line of a week and never submitted.
 */
export async function saveProjectLog(body: SaveProjectLogBody, actor: AccessTokenPayload): Promise<void> {
  const employeeId = await writerFor(actor)
  let date: Date
  try {
    date = parseDateOnly(body.date)
  } catch {
    throw new AppError(400, `${body.date} is not a date on the calendar`)
  }
  if (date.getTime() > officeToday().getTime()) throw new AppError(400, FUTURE_DAY)
  const weekStart = weekStartOf(date)

  await prisma.$transaction(async (tx) => {
    // Checked before the week row is made, so a refusal writes nothing.
    const member = await tx.projectTeamMember.findFirst({
      where: { projectId: body.projectId, employeeId },
      select: { id: true },
    })
    if (!member) throw new AppError(404, NOT_ON_TEAM)

    const week = await tx.weeklyReport.upsert({
      where: { employeeId_weekStart: { employeeId, weekStart } },
      create: { employeeId, weekStart, createdBy: actor.sub },
      update: {},
    })
    // No work and a line are different facts, so only one of them is stored.
    const fields = { noWork: body.noWork, text: body.noWork ? null : body.text!.trim() }
    await tx.projectDailyLog.upsert({
      where: { weeklyReportId_projectId_date: { weeklyReportId: week.id, projectId: body.projectId, date } },
      create: { weeklyReportId: week.id, projectId: body.projectId, date, ...fields },
      update: fields,
    })
    await writeAudit(tx, {
      entity: "WEEKLY_REPORT", entityId: week.id, action: "UPDATE", changedBy: actor.sub,
      after: { date: body.date, projectId: body.projectId, ...fields }, note: "Daily Log written",
    })
  })
}

/** A person takes back a line they wrote. Only their own. */
export async function removeProjectLog(id: string, actor: AccessTokenPayload): Promise<void> {
  const employeeId = await writerFor(actor)
  await prisma.$transaction(async (tx) => {
    const log = await tx.projectDailyLog.findFirst({
      where: { id, weeklyReport: { employeeId } },
      select: { id: true, weeklyReportId: true, projectId: true, text: true },
    })
    if (!log) throw new AppError(404, LOG_NOT_FOUND)
    await tx.projectDailyLog.delete({ where: { id } })
    await writeAudit(tx, {
      entity: "WEEKLY_REPORT", entityId: log.weeklyReportId, action: "UPDATE", changedBy: actor.sub,
      before: { projectId: log.projectId, text: log.text }, note: "Daily Log removed",
    })
  })
}
