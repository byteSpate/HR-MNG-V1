/**
 * Action items handed out at the Saturday review (revision §27.13).
 *
 * **This is the one genuine behaviour change in phase 6.** Every task in the
 * system until now was made by a person for themselves: `createTaskIn` in
 * `task.service.ts` hardcodes `origin: "SELF"`, assigns to the caller, and
 * refuses a change to anybody else's task.
 *
 * That rule is deliberately left exactly as it is. This is a separate path
 * with its own guard, so widening self-service task creation is not something
 * that can happen here by accident — the two never share a function.
 *
 * The guard is narrow on purpose: a Sales Admin, and only from inside an open
 * meeting.
 */

import prisma from "../../../config/prisma"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import { formatDateOnly, parseDateOnly } from "../../../utils/dates"
import { officeDateOf } from "../../attendance/attendance.time"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { employeeIdFor, isSalesAdmin } from "../sales.access"
import type { SalesTaskSummary } from "../sales.types"
import { presentTask } from "../task.present"
import { nextSaturdayFrom } from "./funnel.dates"
import { lockMeeting } from "./funnel.meeting"

export const ACTIONS_ADMIN_ONLY = "Only a Sales Admin can give out an action item"
export const ASSIGNEE_NOT_SALES = "That person is not in the Sales Hub"
export const ACTIONS_NEED_EMPLOYEE = "You need an employee record to give out an action item"
export const ACTION_DEAL_MISSING = "That deal does not exist"
export const ACTION_ACCOUNT_MISSING = "That account does not exist"

const INCLUDE = {
  salesAccount: { select: { name: true } },
  opportunity: { select: { serial: true, name: true } },
  meeting: { select: { title: true } },
  assignedTo: { select: { fullName: true } },
} as const

export interface FunnelActionInput {
  assignedToEmployeeId: string
  title: string
  detail?: string | null
  dueOn?: string
  priority?: "LOW" | "NORMAL" | "HIGH"
  salesAccountId?: string | null
  opportunityId?: string | null
}

/**
 * Gives somebody a piece of work, from inside the review.
 *
 * Due next Saturday by default (§27.13) — the point of the default is "by the
 * next review", which is the reason everyone is in the room.
 *
 * It reaches the assignee through paths that already exist: their task list,
 * their overview, and the existing 00:01 daily email when it becomes due
 * (and on subsequent days while overdue) (§24.14). No new email is sent,
 * and nothing here knows about email at all.
 */
export async function createFunnelAction(
  meetingId: string,
  body: FunnelActionInput,
  actor: AccessTokenPayload,
  now: Date = new Date()
): Promise<SalesTaskSummary> {
  if (!isSalesAdmin(actor)) throw new AppError(403, ACTIONS_ADMIN_ONLY)

  const assignerEmployeeId = await employeeIdFor(actor)
  if (!assignerEmployeeId) throw new AppError(409, ACTIONS_NEED_EMPLOYEE)

  const dueOn = body.dueOn ? parseDateOnly(body.dueOn) : nextSaturdayFrom(officeDateOf(now))
  const priority = body.priority ?? "NORMAL"

  const created = await prisma.$transaction(async (tx) => {
    // Locked and re-read here, not checked beforehand: a meeting completed a
    // moment ago must not take this action item (§27.11).
    await lockMeeting(tx, meetingId, { open: true })

    // The assignee must actually be in the Sales Hub. Handing work to somebody
    // who cannot open the page is a task nobody will ever see.
    const assignee = await tx.employee.findFirst({
      where: { id: body.assignedToEmployeeId, user: { salesRole: { not: null }, isActive: true } },
      select: { id: true },
    })
    if (!assignee) throw new AppError(400, ASSIGNEE_NOT_SALES)

    let salesAccountId = body.salesAccountId ?? null
    if (body.opportunityId) {
      const deal = await tx.opportunity.findUnique({
        where: { id: body.opportunityId },
        select: { id: true, salesAccountId: true },
      })
      if (!deal) throw new AppError(400, ACTION_DEAL_MISSING)
      // Keep the account and the deal consistent, so the task lands on the right
      // Timeline rather than on none.
      salesAccountId = deal.salesAccountId
    } else if (salesAccountId) {
      // An unknown id would be a foreign-key error, which is a 500.
      const account = await tx.salesAccount.findUnique({
        where: { id: salesAccountId },
        select: { id: true },
      })
      if (!account) throw new AppError(400, ACTION_ACCOUNT_MISSING)
    }

    const task = await tx.salesTask.create({
      data: {
        origin: "FUNNEL_MEETING",
        funnelMeetingId: meetingId,
        salesAccountId,
        opportunityId: body.opportunityId ?? null,
        title: body.title,
        detail: body.detail ?? null,
        dueOn,
        priority,
        assignedToEmployeeId: body.assignedToEmployeeId,
        // The whole point of this path: this task has a giver.
        assignedByEmployeeId: assignerEmployeeId,
      },
      include: INCLUDE,
    })

    await writeAudit(tx, {
      entity: "SALES_TASK",
      entityId: task.id,
      action: "CREATE",
      changedBy: actor.sub,
      after: {
        origin: "FUNNEL_MEETING",
        funnelMeetingId: meetingId,
        assignedToEmployeeId: body.assignedToEmployeeId,
        assignedByEmployeeId: assignerEmployeeId,
        title: body.title,
        dueOn: formatDateOnly(dueOn),
        priority,
      },
      note: "Given at a funnel meeting",
    })

    return task
  })

  // `canManage` is false for the giver: an action item belongs to the person
  // it was given to, and the admin's own task screen is not where it lives.
  return presentTask(created, false, officeDateOf(now))
}

/** What was handed out at one meeting. */
export async function listMeetingActions(
  meetingId: string,
  actor: AccessTokenPayload,
  now: Date = new Date()
): Promise<SalesTaskSummary[]> {
  if (!isSalesAdmin(actor)) throw new AppError(403, ACTIONS_ADMIN_ONLY)

  const rows = await prisma.salesTask.findMany({
    where: { funnelMeetingId: meetingId },
    include: INCLUDE,
    orderBy: [{ dueOn: "asc" }, { createdAt: "asc" }],
    take: 200,
  })

  const today = officeDateOf(now)
  return rows.map((row) => presentTask(row, false, today))
}
