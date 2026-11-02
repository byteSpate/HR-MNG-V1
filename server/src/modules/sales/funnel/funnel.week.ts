/**
 * One person's week for the Saturday review (owner, 2026-11-02): what they did
 * and planned, how it splits by type, and their take-outs, on one screen.
 *
 * It looks back at the week that has just finished, the same week the team list
 * reviews (`weekReviewedBy`). The team works Sunday to Thursday. Friday and the
 * optional Saturday before the week appear only when somebody put a task there,
 * so nothing is hidden and nothing empty is shown.
 *
 * Two reads for the whole week, never one per day: the week's tasks, then the
 * open take-outs (which may fall due after the week).
 */

import prisma from "../../../config/prisma"
import { addDays, formatDateOnly, parseDateOnly } from "../../../utils/dates"
import { officeDateOf } from "../../attendance/attendance.time"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { employeeIdFor } from "../sales.access"
import type { PersonWeek, SalesTaskSummary, SalesTaskType } from "../sales.types"
import { presentTask } from "../tasks/task.present"
import { dayRange, TASK_INCLUDE } from "../tasks/task.service"
import { saturdayBefore, weekDays } from "../sales.week"
import { weekReviewedBy } from "./funnel.dates"
import { subjectOf } from "./funnel.service"
import { readTakeOuts } from "./funnel.takeouts"

const DAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const FRIDAY_AFTER_SUNDAY = 5

const noCounts = (): Record<SalesTaskType, number> => ({
  VISIT_FOLLOW_UP: 0,
  QUOTATION_SENT: 0,
  REQUIREMENT_SENT: 0,
  CALL_OR_EMAIL: 0,
  LEARNING: 0,
  INTERNAL_WORK: 0,
  OTHER: 0,
})

export async function getPersonWeek(
  query: { employeeId?: string; week?: string },
  actor: AccessTokenPayload,
  now: Date = new Date()
): Promise<PersonWeek> {
  const subject = await subjectOf(query, actor)
  const own = await employeeIdFor(actor)
  const today = officeDateOf(now)

  const weekStart = query.week ? parseDateOnly(query.week) : weekReviewedBy(today)
  const saturday = saturdayBefore(weekStart)
  const friday = addDays(weekStart, FRIDAY_AFTER_SUNDAY)

  const [rows, open] = await Promise.all([
    prisma.salesTask.findMany({
      where: {
        assignedToEmployeeId: subject.employeeId,
        status: { not: "CANCELLED" },
        AND: dayRange(formatDateOnly(saturday), formatDateOnly(friday)),
      },
      include: TASK_INCLUDE,
      orderBy: [{ dueOn: "asc" }, { createdAt: "asc" }],
      take: 500,
    }),
    readTakeOuts(subject.employeeId, { status: "PENDING" }, own, now),
  ])

  const tasks = rows.map((row) => ({ row, shown: presentTask(row, row.assignedToEmployeeId === own, today) }))

  // A done task counts for the day it was done, any other for its due day.
  const byDay = new Map<string, SalesTaskSummary[]>()
  const counts = noCounts()
  for (const { row, shown } of tasks) {
    const day = formatDateOnly(row.status === "DONE" && row.completedAt ? officeDateOf(row.completedAt) : row.dueOn)
    byDay.set(day, [...(byDay.get(day) ?? []), shown])
    counts[shown.type] += 1
  }

  const dayKeys = [
    ...(byDay.has(formatDateOnly(saturday)) ? [saturday] : []),
    ...weekDays(weekStart),
    ...(byDay.has(formatDateOnly(friday)) ? [friday] : []),
  ].map(formatDateOnly)

  const isTakeOut = (task: SalesTaskSummary) => task.origin === "FUNNEL_MEETING" || task.origin === "TAKE_OUT"

  return {
    weekStart: formatDateOnly(weekStart),
    employee: { id: subject.employeeId, fullName: subject.employeeName },
    days: dayKeys.map((date) => ({
      date,
      label: DAY_NAME[parseDateOnly(date).getUTCDay()],
      tasks: byDay.get(date) ?? [],
    })),
    countsByType: counts,
    takeOuts: {
      open,
      doneThisWeek: tasks.map((t) => t.shown).filter((task) => isTakeOut(task) && task.status === "DONE"),
    },
  }
}
