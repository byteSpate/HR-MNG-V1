import prisma from "../../config/prisma"
import type { Prisma } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import { emitEvent } from "../event/event.emit"
import { officeDateOf } from "../attendance/attendance.time"
import { dec } from "../payroll/payroll.money"
import {
  accountScopeFor,
  canManageAccount,
  commentKindScopeFor,
  employeeIdFor,
  OPPORTUNITY_NOT_VISIBLE,
  requireAccountAccess,
} from "./sales.access"
import { employmentAllowsSales } from "./sales.eligibility"
import { nextOpportunitySerial } from "./sales.serial"
import { presentOpportunity } from "./opportunity.present"
import { MEETING_MODE_LABEL, MEETING_STATUS_LABEL } from "./meeting.present"
import { presentChanges, resolveNames } from "./history.present"
import { createTaskIn } from "./task.service"
import type {
  ChangeOpportunityNextStepBody, ChangeOpportunityStageBody, ChangeOpportunityStatusBody,
  CreateOpportunityBody, ListOpportunityQuery, UpdateOpportunityBody,
} from "./sales.validators"
import type { OpportunityHistory, OpportunityHistoryEntry, TimelineItem } from "./sales.types"

const MS_PER_DAY = 86_400_000
const HISTORY_LIMIT = 100

const INCLUDE = {
  owner: { select: { id: true, fullName: true } },
  // Assignments come along so the payload can answer "may this viewer change
  // it". The directory is shared, so seeing a deal and being able to work it
  // are different questions, and only the server can answer the second.
  salesAccount: {
    select: {
      id: true,
      name: true,
      ownerEmployeeId: true,
      assignments: { select: { employeeId: true } },
    },
  },
  lines: { orderBy: { order: "asc" as const } },
} as const

/** Whether `actor` may write to this deal, decided from its parent account. */
function canManageDeal(
  row: { salesAccount: { ownerEmployeeId: string; assignments: { employeeId: string }[] } },
  actor: AccessTokenPayload,
  employeeId: string | null
): boolean {
  return canManageAccount(
    actor,
    employeeId,
    row.salesAccount.ownerEmployeeId,
    row.salesAccount.assignments.map((a) => a.employeeId)
  )
}

const asClient = (tx: Prisma.TransactionClient) => tx as unknown as typeof prisma
const day = (value: string | null | undefined) => value ? new Date(`${value}T00:00:00.000Z`) : null

async function ownerFor(
  tx: Prisma.TransactionClient,
  account: { id: string; ownerEmployeeId: string },
  ownerEmployeeId: string | undefined,
  addAssignment: boolean | undefined,
  actor: AccessTokenPayload
) {
  const ownerId = ownerEmployeeId ?? account.ownerEmployeeId
  const owner = await tx.employee.findUnique({
    where: { id: ownerId },
    select: {
      id: true,
      fullName: true,
      employmentStatus: true,
      lastWorkingDay: true,
      user: { select: { salesRole: true, isActive: true } },
    },
  })
  if (!owner) throw new AppError(400, "That Opportunity owner is not an employee")
  // Relationship access and actual Hub eligibility are separate facts. An
  // owner or existing collaborator remains named on the account after access
  // is revoked, so validate eligibility before accepting either shortcut.
  if (!owner.user?.salesRole) {
    throw new AppError(
      400,
      `${owner.fullName} does not have Techno Sales Hub access yet. Grant it from their employee record first.`
    )
  }
  if (!employmentAllowsSales(owner.employmentStatus, owner.lastWorkingDay)) {
    throw new AppError(
      400,
      `${owner.fullName} has left the company and cannot be added as a collaborator.`
    )
  }
  if (!owner.user.isActive) {
    throw new AppError(
      400,
      `${owner.fullName}'s login has been deactivated, so they cannot open the hub.`
    )
  }

  if (owner.id === account.ownerEmployeeId) return owner

  const assignment = await tx.salesAccountAssignment.findUnique({
    where: { salesAccountId_employeeId: { salesAccountId: account.id, employeeId: owner.id } },
    select: { id: true },
  })
  if (assignment) return owner
  if (!addAssignment) {
    throw new AppError(
      409,
      `${owner.fullName} does not have access to this Sales Account. Send addAssignment: true to add them as a collaborator in the same action.`
    )
  }

  await tx.salesAccountAssignment.create({
    data: { salesAccountId: account.id, employeeId: owner.id, assignedBy: actor.sub },
  })
  await writeAudit(tx, {
    entity: "SALES_ACCOUNT_ASSIGNMENT", entityId: account.id, action: "ASSIGN",
    changedBy: actor.sub, after: { employeeId: owner.id },
  })
  return owner
}

export async function createOpportunity(body: CreateOpportunityBody, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    const access = await requireAccountAccess(body.salesAccountId, actor, asClient(tx))
    const account = { id: access.accountId, ownerEmployeeId: access.ownerEmployeeId }
    // A deal made from a meeting's minutes (revision §25.6) names that meeting
    // as its origin. Checked before the serial is issued, so a refusal wastes none.
    if (body.meetingId) {
      const origin = await tx.salesMeeting.findFirst({
        where: { id: body.meetingId, salesAccountId: account.id },
        select: { id: true },
      })
      if (!origin) throw new AppError(400, "That meeting is not on this account")
    }
    const owner = await ownerFor(tx, account, body.ownerEmployeeId, body.addAssignment, actor)
    const serial = await nextOpportunitySerial(tx)
    const now = new Date()
    const created = await tx.opportunity.create({
      data: {
        serial, salesAccountId: account.id, name: body.name, track: body.track,
        amount: body.amount === undefined ? null : dec(body.amount),
        expectedCloseDate: day(body.expectedCloseDate),
        oemAccountManager: body.oemAccountManager ?? null,
        ownerEmployeeId: owner.id, stage: "REQUIREMENT_RECEIVED", status: "ONGOING",
        stageChangedAt: now, lastActivityAt: now, createdBy: actor.sub,
        ...(body.meetingId ? { meetingId: body.meetingId } : {}),
      },
      include: INCLUDE,
    })
    await writeAudit(tx, {
      entity: "OPPORTUNITY", entityId: created.id, action: "CREATE", changedBy: actor.sub,
      after: {
        serial, salesAccountId: account.id, name: body.name, ownerEmployeeId: owner.id,
        ...(body.meetingId ? { meetingId: body.meetingId } : {}),
      },
    })
    await emitEvent(tx, {
      type: "sales.opportunity.created", entity: "OPPORTUNITY", entityId: created.id,
      actorUserId: actor.sub, subjectEmployeeId: owner.id, managerEmployeeId: null,
      title: `${serial} · ${body.name} created`, meta: `Owner: ${owner.fullName}`,
      href: `/opportunities/${created.id}`,
    })
    return presentOpportunity(created)
  })
}

export async function listOpportunities(query: ListOpportunityQuery, actor: AccessTokenPayload) {
  const employeeId = await employeeIdFor(actor)
  const limit = query.limit ?? 50
  const now = new Date()
  const today = officeDateOf(now)
  const where: Prisma.OpportunityWhereInput = {
    salesAccount: accountScopeFor(actor, employeeId),
    ...(query.status ? { status: query.status } : {}),
    ...(query.stage ? { stage: query.stage } : {}),
    ...(query.salesAccountId ? { salesAccountId: query.salesAccountId } : {}),
    ...(query.ownerEmployeeId ? { ownerEmployeeId: query.ownerEmployeeId } : {}),
    ...(query.mine ? { ownerEmployeeId: employeeId ?? "__none__" } : {}),
    ...(query.closing ? { expectedCloseDate: { gte: today, lte: new Date(today.getTime() + query.closing * MS_PER_DAY) } } : {}),
    ...(query.quiet ? { lastActivityAt: { lt: new Date(now.getTime() - query.quiet * MS_PER_DAY) } } : {}),
    ...(query.stuck ? { stageChangedAt: { lt: new Date(now.getTime() - query.stuck * MS_PER_DAY) } } : {}),
    ...(query.closing || query.quiet || query.stuck
      ? query.status ? {} : { status: "ONGOING" }
      : {}),
  }
  const rows = await prisma.opportunity.findMany({
    where, include: INCLUDE, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  })
  const hasMore = rows.length > limit
  const page = rows.slice(0, limit)
  return {
    items: page.map((row) => presentOpportunity(row, canManageDeal(row, actor, employeeId))),
    nextCursor: hasMore ? page.at(-1)!.id : null,
  }
}

export async function listOpportunityOwners(actor: AccessTokenPayload) {
  const employeeId = await employeeIdFor(actor)
  const rows = await prisma.opportunity.findMany({
    where: { salesAccount: accountScopeFor(actor, employeeId) },
    distinct: ["ownerEmployeeId"],
    select: { ownerEmployeeId: true, owner: { select: { id: true, fullName: true } } },
    orderBy: { owner: { fullName: "asc" } },
  })
  return rows.map((row) => ({ id: row.owner.id, fullName: row.owner.fullName }))
}

export async function getOpportunityHistory(
  id: string,
  actor: AccessTokenPayload
): Promise<OpportunityHistory> {
  const visible = await getOpportunity(id, actor)
  // Deleted lines are no longer in `visible.lines`, but their create/delete
  // audit carries the parent id. Discover those anchors first so edits made
  // before deletion remain part of the deal's history too.
  const lineAnchors = await prisma.auditLog.findMany({
    where: {
      entity: "OPPORTUNITY_LINE",
      OR: [
        { before: { path: ["opportunityId"], equals: id } },
        { after: { path: ["opportunityId"], equals: id } },
      ],
    },
    select: { entityId: true },
  })
  const lineIds = [...new Set([...visible.lines.map((line) => line.id), ...lineAnchors.map((row) => row.entityId)])]
  const rows = await prisma.auditLog.findMany({
    where: {
      OR: [
        { entity: "OPPORTUNITY", entityId: id },
        ...(lineIds.length > 0
          ? [{ entity: "OPPORTUNITY_LINE" as const, entityId: { in: lineIds } }]
          : []),
      ],
    },
    orderBy: { changedAt: "desc" },
    take: HISTORY_LIMIT + 1,
  })
  const truncated = rows.length > HISTORY_LIMIT
  const page = truncated ? rows.slice(0, HISTORY_LIMIT) : rows
  const names = await resolveNames(page)
  const items: OpportunityHistoryEntry[] = page.map((row) => ({
    id: row.id,
    entity: row.entity as OpportunityHistoryEntry["entity"],
    entityId: row.entityId,
    action: row.action,
    changedAt: row.changedAt.toISOString(),
    changedByName: row.changedBy ? (names.get(row.changedBy) ?? null) : null,
    changes: presentChanges(row.before, row.after, names),
    note: row.note,
  }))
  return { items, truncated, limit: HISTORY_LIMIT }
}

export async function getOpportunity(id: string, actor: AccessTokenPayload) {
  const employeeId = await employeeIdFor(actor)
  const row = await prisma.opportunity.findFirst({
    where: { AND: [{ id }, { salesAccount: accountScopeFor(actor, employeeId) }] },
    include: INCLUDE,
  })
  if (!row) throw new AppError(404, OPPORTUNITY_NOT_VISIBLE)
  return presentOpportunity(row, canManageDeal(row, actor, employeeId))
}

async function loadForWrite(tx: Prisma.TransactionClient, id: string, actor: AccessTokenPayload) {
  const employeeId = await employeeIdFor(actor, asClient(tx))
  const row = await tx.opportunity.findFirst({
    where: { AND: [{ id }, { salesAccount: accountScopeFor(actor, employeeId) }] },
    include: INCLUDE,
  })
  if (!row) throw new AppError(404, OPPORTUNITY_NOT_VISIBLE)
  return row
}

async function auditFields(
  tx: Prisma.TransactionClient, id: string, actor: AccessTokenPayload,
  before: Record<string, unknown>, after: Record<string, unknown>
) {
  for (const field of Object.keys(before)) {
    await writeAudit(tx, {
      entity: "OPPORTUNITY", entityId: id, action: "UPDATE", changedBy: actor.sub,
      before: { [field]: before[field] } as Prisma.InputJsonObject,
      after: { [field]: after[field] } as Prisma.InputJsonObject,
    })
  }
}

export async function updateOpportunity(id: string, body: UpdateOpportunityBody, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    const current = await loadForWrite(tx, id, actor)
    const data: Record<string, unknown> = {}
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    const stage = (field: string, next: unknown, previous: unknown) => {
      if (next !== undefined && String(next) !== String(previous)) {
        data[field] = next; before[field] = previous; after[field] = next
      }
    }
    stage("name", body.name, current.name)
    stage("track", body.track, current.track)
    if (body.amount !== undefined) stage("amount", body.amount === null ? null : dec(body.amount), current.amount)
    if (body.expectedCloseDate !== undefined) stage("expectedCloseDate", day(body.expectedCloseDate), current.expectedCloseDate)
    if (body.oemAccountManager !== undefined) stage("oemAccountManager", body.oemAccountManager, current.oemAccountManager)
    if (body.ownerEmployeeId && body.ownerEmployeeId !== current.ownerEmployeeId) {
      const owner = await ownerFor(tx, current.salesAccount, body.ownerEmployeeId, body.addAssignment, actor)
      stage("ownerEmployeeId", owner.id, current.ownerEmployeeId)
    }
    if (Object.keys(data).length === 0) return presentOpportunity(current)
    data.lastActivityAt = new Date()
    const updated = await tx.opportunity.update({ where: { id }, data, include: INCLUDE })
    await auditFields(tx, id, actor, before, after)
    return presentOpportunity(updated)
  })
}

export async function changeOpportunityStage(id: string, body: ChangeOpportunityStageBody, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    const current = await loadForWrite(tx, id, actor)
    if (current.status !== "ONGOING") throw new AppError(409, "Reopen this Opportunity before changing its stage")
    if (current.stage === body.stage) return presentOpportunity(current)
    const now = new Date()
    const updated = await tx.opportunity.update({
      where: { id }, data: { stage: body.stage, stageChangedAt: now, lastActivityAt: now }, include: INCLUDE,
    })
    await writeAudit(tx, {
      entity: "OPPORTUNITY", entityId: id, action: "UPDATE", changedBy: actor.sub,
      before: { stage: current.stage }, after: { stage: body.stage },
    })
    await emitEvent(tx, {
      type: "sales.opportunity.stage_changed", entity: "OPPORTUNITY", entityId: id,
      actorUserId: actor.sub, subjectEmployeeId: current.ownerEmployeeId, managerEmployeeId: null,
      title: `${current.serial} moved to ${body.stage}`, href: `/opportunities/${id}`,
    })
    return presentOpportunity(updated)
  })
}

export async function changeOpportunityStatus(id: string, body: ChangeOpportunityStatusBody, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    const current = await loadForWrite(tx, id, actor)
    if (current.status === body.status) return presentOpportunity(current)
    if ((body.status === "LOST" || body.status === "CANCELLED") && !body.statusReason?.trim()) {
      throw new AppError(400, `${body.status === "LOST" ? "Lost" : "Cancelled"} Opportunities require a reason`)
    }
    const now = new Date()
    const data: Prisma.OpportunityUpdateInput = {
      status: body.status, lastActivityAt: now,
      statusReason: body.status === "LOST" || body.status === "CANCELLED" ? body.statusReason!.trim() : null,
      ...(body.status === "ONGOING"
        ? { closedAt: null }
        : current.status === "ONGOING" ? { closedAt: now } : {}),
      ...(body.status === "WON" && current.wonByEmployeeId === null
        ? { wonBy: { connect: { id: current.ownerEmployeeId } } } : {}),
    }
    const updated = await tx.opportunity.update({ where: { id }, data, include: INCLUDE })
    await writeAudit(tx, {
      entity: "OPPORTUNITY", entityId: id, action: "UPDATE", changedBy: actor.sub,
      before: { status: current.status }, after: { status: body.status }, note: body.statusReason,
    })
    await emitEvent(tx, {
      type: body.status === "WON" ? "sales.opportunity.won" : "sales.opportunity.closed",
      entity: "OPPORTUNITY", entityId: id, actorUserId: actor.sub,
      subjectEmployeeId: current.ownerEmployeeId, managerEmployeeId: null,
      title: body.status === "ONGOING"
        ? `${current.serial} reopened`
        : `${current.serial} marked ${body.status.toLowerCase()}`,
      meta: body.statusReason ?? null, href: `/opportunities/${id}`,
    })
    return presentOpportunity(updated)
  })
}

export async function changeOpportunityNextStep(id: string, body: ChangeOpportunityNextStepBody, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    const current = await loadForWrite(tx, id, actor)
    const nextStep = body.nextStep === undefined ? current.nextStep : body.nextStep || null
    const nextStepDueOn = body.nextStepDueOn === undefined ? current.nextStepDueOn : day(body.nextStepDueOn)
    // Checked before anything is written, so a refused task leaves the step as it was.
    if (body.alsoCreateTask && (!nextStep || !nextStepDueOn)) {
      throw new AppError(400, "To also make it a task, give the next step some text and a date")
    }
    const now = new Date()
    const updated = await tx.opportunity.update({
      where: { id }, data: { nextStep, nextStepDueOn, lastActivityAt: now }, include: INCLUDE,
    })
    await writeAudit(tx, {
      entity: "OPPORTUNITY", entityId: id, action: "UPDATE", changedBy: actor.sub,
      before: { nextStep: current.nextStep, nextStepDueOn: current.nextStepDueOn },
      after: { nextStep, nextStepDueOn },
    })
    await emitEvent(tx, {
      type: "sales.opportunity.next_step_changed", entity: "OPPORTUNITY", entityId: id,
      actorUserId: actor.sub, subjectEmployeeId: current.ownerEmployeeId, managerEmployeeId: null,
      title: `${current.serial} next step changed`, meta: nextStep, href: `/opportunities/${id}`,
    })
    // The task goes to whoever ticked the box, not the deal's owner (§24.11).
    if (body.alsoCreateTask) {
      await createTaskIn(tx, {
        salesAccountId: current.salesAccountId, opportunityId: id, title: nextStep!, dueOn: nextStepDueOn!,
      }, actor)
    }
    return presentOpportunity(updated)
  })
}

export async function getOpportunityTimeline(id: string, actor: AccessTokenPayload): Promise<{ items: TimelineItem[] }> {
  const visible = await getOpportunity(id, actor)
  const [comments, events, meetings] = await Promise.all([
    prisma.salesComment.findMany({
      where: { entity: "OPPORTUNITY", entityId: id, ...commentKindScopeFor(actor) }, orderBy: { createdAt: "desc" }, take: 100,
      include: {
        author: { select: { fullName: true } },
        authorUser: { select: { displayName: true, email: true } },
      },
    }),
    prisma.event.findMany({
      where: {
        OR: [
          { entity: "OPPORTUNITY", entityId: id },
          // A linked meeting's story. Its scheduled, moved, completed and
          // cancelled events are written against the account and name this
          // deal in their payload, so the deal shows them without a second
          // event for the same change.
          {
            entity: "SALES_ACCOUNT", entityId: visible.salesAccountId, type: { startsWith: "sales.meeting." },
            payload: { path: ["opportunityId"], equals: id },
          },
          // Its minutes being written and sent (revision §25.33), named the same way.
          {
            entity: "SALES_ACCOUNT", entityId: visible.salesAccountId, type: { startsWith: "sales.minutes." },
            payload: { path: ["opportunityId"], equals: id },
          },
        ],
      },
      orderBy: { createdAt: "desc" }, take: 100,
    }),
    // The meetings about this deal as they stand now, beside their story above.
    prisma.salesMeeting.findMany({
      where: { opportunityId: id }, orderBy: { scheduledAt: "desc" }, take: 100,
      select: { id: true, title: true, mode: true, status: true, scheduledAt: true },
    }),
  ])
  const items: TimelineItem[] = [
    ...meetings.map((row) => ({ id: `meeting:${row.id}`, kind: "meeting" as const,
      at: row.scheduledAt.toISOString(), title: row.title,
      meta: `${MEETING_MODE_LABEL[row.mode]} · ${MEETING_STATUS_LABEL[row.status]}`, by: null, detail: null })),
    ...comments.map((row) => ({ id: `comment:${row.id}`, kind: "comment" as const,
      at: row.createdAt.toISOString(), title: row.kind === "MANAGEMENT_NOTE" ? "Management note" : "Comment",
      meta: null, by: row.author?.fullName ?? row.authorUser.displayName ?? row.authorUser.email,
      detail: row.body })),
    ...events.map((row) => ({ id: `event:${row.id}`, kind: "event" as const,
      at: row.createdAt.toISOString(), title: row.title, meta: row.meta, by: null, detail: null })),
  ]
  items.sort((a, b) => b.at.localeCompare(a.at))
  return { items: items.slice(0, 100) }
}
