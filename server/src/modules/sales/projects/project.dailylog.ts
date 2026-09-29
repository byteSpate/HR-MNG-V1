import prisma from "../../../config/prisma"
import { AppError } from "../../../middleware/errorHandler"
import { formatDateOnly, parseDateOnly } from "../../../utils/dates"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { officeToday } from "../../attendance/attendance.time"
import { resolveShift } from "../../attendance/attendance.grid"
import type { ProjectDailyLogView } from "../sales.types"
import { dayLabelOf, weekDays, weekEndOf, weekStartOf } from "../weekly/weekly.dates"
import { loadProjectRow } from "./project.access"

/**
 * The Project's Daily Log for one week, one row per team member (spec §2.2).
 *
 * Which days owe a line is decided the same way the Weekly Report decides it:
 * an ordinary working day for that person, that has already happened, with no
 * holiday, no leave and no weekly off on it. Those are the days a person could
 * have written something and did not.
 */
export async function getProjectDailyLog(
  projectId: string,
  query: { week?: string },
  actor: AccessTokenPayload,
): Promise<ProjectDailyLogView> {
  const { row } = await loadProjectRow(prisma, projectId, actor)
  let anchor: Date
  try {
    anchor = query.week ? parseDateOnly(query.week) : officeToday()
  } catch {
    throw new AppError(400, `${query.week} is not a date on the calendar`)
  }
  const weekStart = weekStartOf(anchor)
  const from = weekStart
  const to = weekEndOf(weekStart)
  const memberIds = row.team.map((m) => m.employeeId)
  const [shifts, holidays, leaves, people, logs] = await Promise.all([
    prisma.shift.findMany(),
    prisma.holiday.findMany({ where: { date: { gte: from, lte: to } }, select: { date: true, name: true, type: true } }),
    prisma.leaveRequest.findMany({
      where: { employeeId: { in: memberIds }, status: "APPROVED", startDate: { lte: to }, endDate: { gte: from } },
      select: { employeeId: true, startDate: true, endDate: true, startSession: true, endSession: true },
    }),
    prisma.employee.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, fullName: true, shiftId: true, joiningDate: true, lastWorkingDay: true },
      orderBy: { fullName: "asc" },
    }),
    prisma.projectDailyLog.findMany({
      where: { projectId, date: { gte: from, lte: to } },
      select: { date: true, noWork: true, text: true, weeklyReport: { select: { employeeId: true } } },
    }),
  ])
  const today = officeToday()
  // Today's status decides, as on the Weekly Report: the app keeps no
  // day-by-day history of a Project's status, so there is nothing to say
  // about a day the Project was not yet running.
  const inProgress = row.status === "IN_PROGRESS"
  return {
    weekStart: formatDateOnly(weekStart),
    days: weekDays(weekStart).map((date) => ({
      date: formatDateOnly(date),
      people: people.map((p) => {
        const label = dayLabelOf(date, {
          shift: resolveShift({ shiftId: p.shiftId }, weekStart, shifts),
          holidays,
          leaves: leaves.filter((l) => l.employeeId === p.id),
          joiningDate: p.joiningDate,
          lastWorkingDay: p.lastWorkingDay,
        })
        const log = logs.find(
          (l) => l.weeklyReport.employeeId === p.id && l.date.getTime() === date.getTime(),
        )
        return {
          employeeId: p.id,
          fullName: p.fullName,
          label: label?.text ?? null,
          noWork: log?.noWork ?? false,
          text: log?.text ?? null,
          missing: inProgress && !log && label === null && date.getTime() <= today.getTime(),
        }
      }),
    })),
  }
}
