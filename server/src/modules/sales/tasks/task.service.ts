/**
 * Follow-up tasks: something one person must do by a date.
 *
 * In phase 3 a task is always its maker's own (revision §24.7): the owner is
 * the caller and the origin is SELF, whatever the request says. Giving a task
 * to somebody else is the funnel meeting's action item (phase 6), which has its
 * own guarded path in `funnel/funnel.actions.ts`; this file's rule is unchanged.
 *
 * Every task hangs off an account its maker works (§24.8), so it shows on that
 * account's Timeline. Reading follows §24.20: the owner, the people who work
 * the account, and Sales Admins. Changing one is the owner's alone.
 */

import prisma from "../../../config/prisma"
import type { Prisma } from "../../../generated/prisma/client"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import { addDays, formatDateOnly, formatShortDate, parseDateOnly } from "../../../utils/dates"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { officeDateOf } from "../../attendance/attendance.time"
import { emitEvent } from "../../event/event.emit"
import { accountScopeFor, employeeIdFor, isSalesAdmin, requireAccountAccess } from "../sales.access"
import type { SalesTaskStatusResult, SalesTaskSummary } from "../sales.types"
import type { ChangeTaskStatusBody, CreateTaskBody, ListTaskQuery, UpdateTaskBody } from "./task.validators"
import { presentTask, TASK_STATUS_LABEL } from "./task.present"

export const TASK_NOT_VISIBLE = "That task does not exist, or is not yours"

/** First-plan decision 21: after a follow-up is done, the next is offered 15 days out. */
export const FOLLOW_UP_DAYS = 15
const WEEK_DAYS = 7

const asClient = (tx: Prisma.TransactionClient) => tx as unknown as typeof prisma

const INCLUDE = {
  salesAccount: { select: { name: true } },
  opportunity: { select: { serial: true, name: true } },
  meeting: { select: { title: true } },
  assignedTo: { select: { fullName: true } },
} satisfies Prisma.SalesTaskInclude

/** A date the user picked, refused as a 400 rather than a 500 when it is not on the calendar. */
function dueDate(value: string): Date {
  try {
    return parseDateOnly(value)
  } catch {
    throw new AppError(400, `${value} is not a date on the calendar`)
  }
}

/**
 * Which tasks a caller may read, as `AND` clauses (§24.20). A Sales Admin
 * reads them all. Anyone else reads their own and those on accounts they
 * work. With no employee record there is nothing of theirs to read.
 */
export function taskScopeFor(actor: AccessTokenPayload, employeeId: string | null): Prisma.SalesTaskWhereInput[] {
  if (isSalesAdmin(actor)) return []
  if (!employeeId) return [{ id: "__none__" }]
  return [{ OR: [{ assignedToEmployeeId: employeeId }, { salesAccount: accountScopeFor(actor, employeeId) }] }]
}

/** The due filters, read against the office date (§24.13). Overdue only means something for a pending task. */
function dueFilter(due: ListTaskQuery["due"], today: Date): Prisma.SalesTaskWhereInput {
  if (due === "overdue") return { status: "PENDING", dueOn: { lt: today } }
  if (due === "today") return { dueOn: today }
  if (due === "now") return { status: "PENDING", dueOn: { lte: today } }
  if (due === "week") return { dueOn: { gte: today, lt: addDays(today, WEEK_DAYS) } }
  return {}
}

interface NewTask {
  salesAccountId: string
  opportunityId?: string | null
  meetingId?: string | null
  title: string
  detail?: string | null
  dueOn: Date
  priority?: "LOW" | "NORMAL" | "HIGH"
}

/**
 * Makes one task for the caller inside the caller's transaction, with its
 * audit row and event. Shared with a deal's Next step, whose box can make one
 * too (§24.11), so both ways in keep the same rules.
 */
export async function createTaskIn(tx: Prisma.TransactionClient, input: NewTask, actor: AccessTokenPayload) {
  const access = await requireAccountAccess(input.salesAccountId, actor, asClient(tx))
  // Super Admin and HR Admin are seeded with no Employee row, and a task needs
  // somebody to belong to.
  if (!access.employeeId) {
    throw new AppError(400, "Only an employee can have tasks, and your account has no employee record")
  }
  if (input.opportunityId) {
    const deal = await tx.opportunity.findFirst({
      where: { id: input.opportunityId, salesAccountId: access.accountId },
      select: { id: true },
    })
    if (!deal) throw new AppError(400, "That deal is not on this account")
  }
  if (input.meetingId) {
    const meeting = await tx.salesMeeting.findFirst({
      where: { id: input.meetingId, salesAccountId: access.accountId },
      select: { id: true },
    })
    if (!meeting) throw new AppError(400, "That meeting is not on this account")
  }

  const priority = input.priority ?? "NORMAL"
  const created = await tx.salesTask.create({
    data: {
      origin: "SELF",
      salesAccountId: access.accountId,
      opportunityId: input.opportunityId ?? null,
      meetingId: input.meetingId ?? null,
      title: input.title,
      detail: input.detail ?? null,
      dueOn: input.dueOn,
      priority,
      assignedToEmployeeId: access.employeeId,
      assignedByEmployeeId: null,
    },
    include: INCLUDE,
  })

  await writeAudit(tx, {
    entity: "SALES_TASK",
    entityId: created.id,
    action: "CREATE",
    changedBy: actor.sub,
    after: {
      salesAccountId: access.accountId,
      title: input.title,
      dueOn: formatDateOnly(input.dueOn),
      priority,
      opportunityId: input.opportunityId ?? null,
      meetingId: input.meetingId ?? null,
    },
  })
  // Keyed to the task, not the account. The account's Timeline is open to every
  // hub member and a task is not; the Timeline reads tasks itself, for the
  // people allowed to see them.
  await emitEvent(tx, {
    type: "sales.task.created",
    entity: "SALES_TASK",
    entityId: created.id,
    actorUserId: actor.sub,
    subjectEmployeeId: access.employeeId,
    managerEmployeeId: null,
    title: `Task added: ${input.title}`,
    meta: `Due ${formatShortDate(input.dueOn)}`,
    href: "/tasks",
  })
  return created
}

export async function createTask(body: CreateTaskBody, actor: AccessTokenPayload): Promise<SalesTaskSummary> {
  const dueOn = dueDate(body.dueOn)
  return prisma.$transaction(async (tx) => {
    const created = await createTaskIn(tx, { ...body, dueOn }, actor)
    return presentTask(created, true, officeDateOf(new Date()))
  })
}

/**
 * The task, if the caller owns it. Anyone else gets the words a missing task
 * gets, as every write gate in the hub does: a Sales Admin can read somebody's
 * task but not change it.
 */
async function taskForWrite(tx: Prisma.TransactionClient, id: string, actor: AccessTokenPayload) {
  const employeeId = await employeeIdFor(actor, asClient(tx))
  const task = await tx.salesTask.findFirst({ where: { id }, include: INCLUDE })
  if (!task || !employeeId || task.assignedToEmployeeId !== employeeId) {
    throw new AppError(404, TASK_NOT_VISIBLE)
  }
  return task
}

async function requireOnAccount(
  tx: Prisma.TransactionClient,
  kind: "deal" | "meeting",
  id: string,
  salesAccountId: string | null
) {
  const where = { id, salesAccountId: salesAccountId ?? "__none__" }
  const found =
    kind === "deal"
      ? await tx.opportunity.findFirst({ where, select: { id: true } })
      : await tx.salesMeeting.findFirst({ where, select: { id: true } })
  if (!found) throw new AppError(400, `That ${kind} is not on this account`)
}

export async function updateTask(id: string, body: UpdateTaskBody, actor: AccessTokenPayload): Promise<SalesTaskSummary> {
  return prisma.$transaction(async (tx) => {
    const current = await taskForWrite(tx, id, actor)
    const data: Prisma.SalesTaskUncheckedUpdateInput = {}
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}

    for (const field of ["title", "detail", "priority"] as const) {
      const next = body[field]
      if (next === undefined || next === current[field]) continue
      data[field] = next as never
      before[field] = current[field]
      after[field] = next
    }
    if (body.dueOn !== undefined) {
      const next = dueDate(body.dueOn)
      if (next.getTime() !== current.dueOn.getTime()) {
        data.dueOn = next
        before.dueOn = formatDateOnly(current.dueOn)
        after.dueOn = body.dueOn
      }
    }
    if (body.opportunityId !== undefined && body.opportunityId !== current.opportunityId) {
      if (body.opportunityId !== null) await requireOnAccount(tx, "deal", body.opportunityId, current.salesAccountId)
      data.opportunityId = body.opportunityId
      before.opportunityId = current.opportunityId
      after.opportunityId = body.opportunityId
    }
    if (body.meetingId !== undefined && body.meetingId !== current.meetingId) {
      if (body.meetingId !== null) await requireOnAccount(tx, "meeting", body.meetingId, current.salesAccountId)
      data.meetingId = body.meetingId
      before.meetingId = current.meetingId
      after.meetingId = body.meetingId
    }

    const today = officeDateOf(new Date())
    if (Object.keys(data).length === 0) return presentTask(current, true, today)

    const updated = await tx.salesTask.update({ where: { id }, data, include: INCLUDE })
    await writeAudit(tx, {
      entity: "SALES_TASK",
      entityId: id,
      action: "UPDATE",
      changedBy: actor.sub,
      before: before as Prisma.InputJsonObject,
      after: after as Prisma.InputJsonObject,
    })
    return presentTask(updated, true, today)
  })
}

/**
 * Done, Cancelled, or back to Pending (§24.10). Done takes an optional
 * outcome and offers the next follow-up; Cancelled needs a reason; reopening
 * clears whatever closed it, and the audit row keeps what that was.
 */
export async function changeTaskStatus(
  id: string,
  body: ChangeTaskStatusBody,
  actor: AccessTokenPayload,
  now: Date = new Date()
): Promise<SalesTaskStatusResult> {
  return prisma.$transaction(async (tx) => {
    const current = await taskForWrite(tx, id, actor)
    if (current.status === body.status) {
      throw new AppError(400, `This task is already ${TASK_STATUS_LABEL[body.status].toLowerCase()}`)
    }

    const cleared = { outcome: null, cancelReason: null, completedAt: null, completedBy: null }
    const data: Prisma.SalesTaskUncheckedUpdateInput =
      body.status === "DONE"
        ? { ...cleared, status: "DONE", outcome: body.outcome ?? null, completedAt: now, completedBy: actor.sub }
        : body.status === "CANCELLED"
          ? { ...cleared, status: "CANCELLED", cancelReason: body.reason }
          : { ...cleared, status: "PENDING" }

    const updated = await tx.salesTask.update({ where: { id }, data, include: INCLUDE })
    await writeAudit(tx, {
      entity: "SALES_TASK",
      entityId: id,
      action: "UPDATE",
      changedBy: actor.sub,
      before: {
        status: current.status,
        ...(current.outcome ? { outcome: current.outcome } : {}),
        ...(current.cancelReason ? { cancelReason: current.cancelReason } : {}),
      },
      after: {
        status: body.status,
        ...(body.status === "DONE" ? { outcome: body.outcome ?? null } : {}),
        ...(body.status === "CANCELLED" ? { cancelReason: body.reason } : {}),
      },
    })
    if (body.status === "DONE") {
      await emitEvent(tx, {
        type: "sales.task.completed",
        entity: "SALES_TASK",
        entityId: id,
        actorUserId: actor.sub,
        subjectEmployeeId: current.assignedToEmployeeId,
        managerEmployeeId: null,
        title: `Task done: ${current.title}`,
        meta: body.outcome ?? null,
        href: "/tasks",
      })
    }

    const today = officeDateOf(now)
    return {
      ...presentTask(updated, true, today),
      nextFollowUpOn: body.status === "DONE" ? formatDateOnly(addDays(today, FOLLOW_UP_DAYS)) : null,
    }
  })
}

export async function getTask(id: string, actor: AccessTokenPayload): Promise<SalesTaskSummary> {
  const employeeId = await employeeIdFor(actor)
  const task = await prisma.salesTask.findFirst({
    where: { AND: [{ id }, ...taskScopeFor(actor, employeeId)] },
    include: INCLUDE,
  })
  if (!task) throw new AppError(404, TASK_NOT_VISIBLE)
  return presentTask(task, task.assignedToEmployeeId === employeeId, officeDateOf(new Date()))
}

/** Soonest due first, the most urgent first within a day. */
export async function listTasks(
  query: ListTaskQuery,
  actor: AccessTokenPayload,
  now: Date = new Date()
): Promise<{ items: SalesTaskSummary[] }> {
  const employeeId = await employeeIdFor(actor)
  const today = officeDateOf(now)
  const where: Prisma.SalesTaskWhereInput = {
    AND: taskScopeFor(actor, employeeId),
    ...dueFilter(query.due, today),
    ...(query.status ? { status: query.status } : {}),
    ...(query.origin ? { origin: query.origin } : {}),
    ...(query.salesAccountId ? { salesAccountId: query.salesAccountId } : {}),
    ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
    ...(query.meetingId ? { meetingId: query.meetingId } : {}),
    ...(query.mine ? { assignedToEmployeeId: employeeId ?? "__none__" } : {}),
  }
  const rows = await prisma.salesTask.findMany({
    where,
    include: INCLUDE,
    orderBy: [{ dueOn: "asc" }, { priority: "desc" }, { createdAt: "asc" }],
    take: 500,
  })
  return { items: rows.map((row) => presentTask(row, row.assignedToEmployeeId === employeeId, today)) }
}
