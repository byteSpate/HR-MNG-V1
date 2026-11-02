/**
 * Take-outs (owner, 2026-11-02): something an admin asks a person to do, given
 * on a funnel row or straight to the person. A Saturday action item is the same
 * kind of thing given inside a meeting, so both are listed together, and both
 * show who gave them and on which day.
 *
 * It is the same `SalesTask` record. The person marks it Done on their own
 * Tasks page, as with any task. Writing one is for a Sales Admin or a Super
 * Admin only; reading is the Funnel's own rule (yours, or the team switch).
 */

import prisma from "../../../config/prisma"
import { AppError } from "../../../middleware/errorHandler"
import { parseDateOnly } from "../../../utils/dates"
import { officeDateOf } from "../../attendance/attendance.time"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { employeeIdFor, isSalesAdmin } from "../sales.access"
import type { SalesTaskSummary } from "../sales.types"
import { presentTask } from "../tasks/task.present"
import { dayRange } from "../tasks/task.service"
import { ACTIONS_NEED_EMPLOYEE, giveTaskIn, type FunnelActionInput } from "./funnel.actions"
import { nextSaturdayFrom } from "./funnel.dates"
import { subjectOf } from "./funnel.service"

export const TAKE_OUT_ADMIN_ONLY = "Only a Sales Admin can give a take-out"

const INCLUDE = {
  salesAccount: { select: { name: true } },
  opportunity: { select: { serial: true, name: true } },
  meeting: { select: { title: true } },
  assignedTo: { select: { fullName: true } },
  assignedBy: { select: { fullName: true } },
} as const

export type TakeOutInput = FunnelActionInput

/**
 * Gives a take-out, with no meeting needed: an admin may write one any day.
 * Due the next Saturday unless a day is given, so it is there for the next review.
 */
export async function createTakeOut(
  body: TakeOutInput,
  actor: AccessTokenPayload,
  now: Date = new Date()
): Promise<SalesTaskSummary> {
  if (!isSalesAdmin(actor)) throw new AppError(403, TAKE_OUT_ADMIN_ONLY)

  const assignerEmployeeId = await employeeIdFor(actor)
  if (!assignerEmployeeId) throw new AppError(409, ACTIONS_NEED_EMPLOYEE)

  const dueOn = body.dueOn ? parseDateOnly(body.dueOn) : nextSaturdayFrom(officeDateOf(now))
  const priority = body.priority ?? "NORMAL"

  const created = await prisma.$transaction((tx) =>
    giveTaskIn(tx, body, {
      origin: "TAKE_OUT",
      funnelMeetingId: null,
      assignerEmployeeId,
      dueOn,
      priority,
      actor,
      note: "Given as a take-out",
    })
  )

  // The giver does not own the task, so they cannot change it from here.
  return presentTask(created, false, officeDateOf(now))
}

export interface TakeOutQuery {
  /** Whose take-outs. Absent means the caller's own. */
  employeeId?: string
  opportunityId?: string
  status?: "PENDING" | "DONE"
  /** The day range a take-out counts for (done day, or due day when not done). */
  from?: string
  to?: string
}

/** Take-outs and meeting action items of one person, open ones first. */
export async function listTakeOuts(
  query: TakeOutQuery,
  actor: AccessTokenPayload,
  now: Date = new Date()
): Promise<SalesTaskSummary[]> {
  const subject = await subjectOf(query, actor)
  const own = await employeeIdFor(actor)

  const rows = await prisma.salesTask.findMany({
    where: {
      assignedToEmployeeId: subject.employeeId,
      origin: { in: ["FUNNEL_MEETING", "TAKE_OUT"] },
      ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
      ...(query.status ? { status: query.status } : {}),
      AND: dayRange(query.from, query.to),
    },
    include: INCLUDE,
    orderBy: [{ status: "asc" }, { dueOn: "asc" }, { createdAt: "asc" }],
    take: 200,
  })

  const today = officeDateOf(now)
  return rows.map((row) => presentTask(row, row.assignedToEmployeeId === own, today))
}
