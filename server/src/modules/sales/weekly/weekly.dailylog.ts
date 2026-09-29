import prisma from "../../../config/prisma"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import { parseDateOnly } from "../../../utils/dates"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { weekStartOf } from "./weekly.dates"
import { openWeekFor, writableDate, writerFor } from "./weekly.service"
import type { SaveProjectLogBody } from "./weekly.validators"

const NOT_ON_TEAM = "That Project does not exist, or you are not on its team"
const LOG_NOT_FOUND = "That line does not exist, or is not yours"

/**
 * One Daily Log line (spec §2.2): what I did on this Project that day, or that
 * I did no work on it. A person writes only for Projects whose team they are
 * on, and only for a day that has already happened — the same two rules Other
 * work follows, so a Weekly Report is written the same way throughout.
 */
export async function saveProjectLog(body: SaveProjectLogBody, actor: AccessTokenPayload): Promise<void> {
  const employeeId = await writerFor(actor)
  let picked: Date
  try {
    picked = parseDateOnly(body.date)
  } catch {
    throw new AppError(400, `${body.date} is not a date on the calendar`)
  }
  const weekStart = weekStartOf(picked)
  const date = writableDate(body.date, weekStart)

  await prisma.$transaction(async (tx) => {
    // Checked before the week is opened, so a refusal writes nothing.
    const member = await tx.projectTeamMember.findFirst({
      where: { projectId: body.projectId, employeeId },
      select: { id: true },
    })
    if (!member) throw new AppError(404, NOT_ON_TEAM)

    const report = await openWeekFor(tx, employeeId, weekStart, actor)
    // No work and a line are different facts, so only one of them is stored.
    const fields = { noWork: body.noWork, text: body.noWork ? null : body.text!.trim() }
    await tx.projectDailyLog.upsert({
      where: { weeklyReportId_projectId_date: { weeklyReportId: report.id, projectId: body.projectId, date } },
      create: { weeklyReportId: report.id, projectId: body.projectId, date, ...fields },
      update: fields,
    })
    await writeAudit(tx, {
      entity: "WEEKLY_REPORT", entityId: report.id, action: "UPDATE", changedBy: actor.sub,
      after: { date: body.date, projectId: body.projectId, ...fields }, note: "Daily Log written",
    })
  })
}

/** A person takes back a line they wrote. Only their own: the report is theirs. */
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
