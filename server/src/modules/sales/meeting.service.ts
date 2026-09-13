/**
 * Meetings with customers: a visit, a meeting at our office, or one online.
 *
 * A meeting belongs to a Sales Account and inherits its access. Anyone who
 * works the account (owner, collaborators, Sales Admins) may schedule, edit,
 * move and end its meetings; anyone in the hub may read them, the same rule
 * as the account's Timeline. Settled in the revision's §24.
 *
 * Moving a meeting is editing `scheduledAt`. There is no RESCHEDULED status:
 * a moved meeting is a fact for the Timeline, not a state of the meeting.
 */

import prisma from "../../config/prisma"
import { env } from "../../config/env"
import type { Prisma } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import { emitEvent } from "../event/event.emit"
import { standingOf } from "./account.service"
import { MEETING_MODE_LABEL, MEETING_STATUS_LABEL, presentMeeting } from "./meeting.present"
import { canManageAccount, employeeIdFor, requireAccountAccess } from "./sales.access"
import { canWorkAccounts } from "./sales.eligibility"
import type { SalesMeetingSummary } from "./sales.types"
import type {
  ChangeMeetingStatusBody,
  CreateMeetingBody,
  ListMeetingQuery,
  UpdateMeetingBody,
} from "./sales.validators"

export const MEETING_NOT_VISIBLE = "That meeting does not exist, or is not yours"

const asClient = (tx: Prisma.TransactionClient) => tx as unknown as typeof prisma

const INCLUDE = {
  salesAccount: {
    select: { name: true, ownerEmployeeId: true, assignments: { select: { employeeId: true } } },
  },
  opportunity: { select: { serial: true, name: true } },
  attendees: {
    include: { employee: { select: { fullName: true } }, contact: { select: { name: true } } },
  },
} satisfies Prisma.SalesMeetingInclude

type AttendeeInput = CreateMeetingBody["attendees"][number]

/** "Sun 20 Sep, 10:00" in office time, for event titles. */
function whenLabel(at: Date): string {
  return at.toLocaleString("en-GB", {
    timeZone: env.APP_TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * The attendee rows to write, after the checks that make them true.
 *
 * Our side must be able to work in the hub: a sales role, a working login and
 * still employed. The refusal names the person, because "an attendee is not
 * eligible" leaves the scheduler guessing which one. The scheduler, when there
 * is one, is on our side first, and nobody is listed twice.
 *
 * Their side is a saved contact of this account, or a typed name for someone
 * who is not saved. A contact from another account is refused rather than
 * silently attached to the wrong company.
 */
async function attendeeRows(
  tx: Prisma.TransactionClient,
  salesAccountId: string,
  attendees: AttendeeInput[],
  schedulerEmployeeId: string | null
) {
  const ourIds = [
    ...new Set([
      ...(schedulerEmployeeId ? [schedulerEmployeeId] : []),
      ...attendees.filter((a) => a.side === "OURS" && a.employeeId).map((a) => a.employeeId!),
    ]),
  ]
  if (ourIds.length > 0) {
    const people = await tx.employee.findMany({
      where: { id: { in: ourIds } },
      select: {
        id: true,
        fullName: true,
        employmentStatus: true,
        lastWorkingDay: true,
        user: { select: { salesRole: true, isActive: true } },
      },
    })
    const byId = new Map(people.map((person) => [person.id, person]))
    for (const id of ourIds) {
      const person = byId.get(id)
      if (!person) throw new AppError(400, "Somebody on our side is not an employee")
      if (!canWorkAccounts(standingOf(person))) {
        throw new AppError(400, `${person.fullName} cannot attend: they do not have Sales Hub access`)
      }
    }
  }

  const theirs = attendees.filter((a) => a.side === "THEIRS")
  const contactIds = [...new Set(theirs.filter((a) => a.contactId).map((a) => a.contactId!))]
  if (contactIds.length > 0) {
    const found = await tx.salesContact.findMany({
      where: { id: { in: contactIds }, salesAccountId },
      select: { id: true },
    })
    if (found.length !== contactIds.length) {
      throw new AppError(400, "A contact on their side is not a contact of this account")
    }
  }

  return [
    ...ourIds.map((employeeId) => ({ side: "OURS" as const, employeeId })),
    ...theirs.map((a) => ({
      side: "THEIRS" as const,
      contactId: a.contactId ?? null,
      name: a.contactId ? null : (a.name ?? null),
      designation: a.designation ?? null,
    })),
  ]
}

/** A deal a meeting is about must be a deal on the same account. */
async function requireDealOnAccount(tx: Prisma.TransactionClient, opportunityId: string, salesAccountId: string) {
  const deal = await tx.opportunity.findFirst({
    where: { id: opportunityId, salesAccountId },
    select: { id: true },
  })
  if (!deal) throw new AppError(400, "That deal is not on this account")
}

/** The meeting, after the same write gate as its account. */
async function meetingForWrite(tx: Prisma.TransactionClient, id: string, actor: AccessTokenPayload) {
  const meeting = await tx.salesMeeting.findFirst({ where: { id }, include: INCLUDE })
  if (!meeting) throw new AppError(404, MEETING_NOT_VISIBLE)
  await requireAccountAccess(meeting.salesAccountId, actor, asClient(tx))
  return meeting
}

function canManageMeeting(
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

export async function createMeeting(
  body: CreateMeetingBody,
  actor: AccessTokenPayload
): Promise<SalesMeetingSummary> {
  return prisma.$transaction(async (tx) => {
    const access = await requireAccountAccess(body.salesAccountId, actor, asClient(tx))
    if (body.opportunityId) await requireDealOnAccount(tx, body.opportunityId, access.accountId)
    const attendees = await attendeeRows(tx, access.accountId, body.attendees ?? [], access.employeeId)
    const mode = body.mode ?? "CUSTOMER_SITE"
    const scheduledAt = new Date(body.scheduledAt)

    const created = await tx.salesMeeting.create({
      data: {
        salesAccountId: access.accountId,
        opportunityId: body.opportunityId ?? null,
        title: body.title,
        mode,
        scheduledAt,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
        location: body.location ?? null,
        notes: body.notes ?? null,
        createdBy: actor.sub,
        attendees: { create: attendees },
      },
      include: INCLUDE,
    })

    await writeAudit(tx, {
      entity: "SALES_MEETING",
      entityId: created.id,
      action: "CREATE",
      changedBy: actor.sub,
      after: {
        salesAccountId: access.accountId,
        title: body.title,
        mode,
        scheduledAt: scheduledAt.toISOString(),
        opportunityId: body.opportunityId ?? null,
      },
    })
    // Against the account, so the account's Timeline tells the story with no
    // second timeline system. The link is the account page, which exists.
    await emitEvent(tx, {
      type: "sales.meeting.scheduled",
      entity: "SALES_ACCOUNT",
      entityId: access.accountId,
      actorUserId: actor.sub,
      // The account owner is the audience, as the deal owner is for deal
      // events. Telling each attendee arrives with the reminder emails.
      subjectEmployeeId: access.ownerEmployeeId,
      managerEmployeeId: null,
      title: `Meeting scheduled: ${body.title}`,
      meta: `${whenLabel(scheduledAt)} · ${MEETING_MODE_LABEL[mode]}`,
      href: `/accounts/${access.accountId}`,
    })
    return presentMeeting(created)
  })
}

export async function updateMeeting(
  id: string,
  body: UpdateMeetingBody,
  actor: AccessTokenPayload
): Promise<SalesMeetingSummary> {
  return prisma.$transaction(async (tx) => {
    const current = await meetingForWrite(tx, id, actor)
    const moving =
      body.scheduledAt !== undefined && new Date(body.scheduledAt).getTime() !== current.scheduledAt.getTime()
    if ((moving || body.endsAt !== undefined) && current.status !== "SCHEDULED") {
      throw new AppError(
        400,
        "Only a scheduled meeting can be moved. Put a cancelled meeting back to scheduled first."
      )
    }

    const data: Prisma.SalesMeetingUncheckedUpdateInput = {}
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}

    for (const field of ["title", "mode", "location", "notes"] as const) {
      const next = body[field]
      if (next === undefined || next === current[field]) continue
      data[field] = next as never
      before[field] = current[field]
      after[field] = next
    }
    if (moving) {
      data.scheduledAt = new Date(body.scheduledAt!)
      before.scheduledAt = current.scheduledAt.toISOString()
      after.scheduledAt = new Date(body.scheduledAt!).toISOString()
    }
    if (body.endsAt !== undefined) {
      const next = body.endsAt === null ? null : new Date(body.endsAt)
      if ((next?.getTime() ?? null) !== (current.endsAt?.getTime() ?? null)) {
        data.endsAt = next
        before.endsAt = current.endsAt?.toISOString() ?? null
        after.endsAt = next?.toISOString() ?? null
      }
    }
    if (body.opportunityId !== undefined && body.opportunityId !== current.opportunityId) {
      if (body.opportunityId !== null) await requireDealOnAccount(tx, body.opportunityId, current.salesAccountId)
      data.opportunityId = body.opportunityId
      before.opportunityId = current.opportunityId
      after.opportunityId = body.opportunityId
    }
    if (body.attendees !== undefined) {
      // The list replaces the old one as given; the scheduler is not re-added.
      const rows = await attendeeRows(tx, current.salesAccountId, body.attendees, null)
      await tx.salesMeetingAttendee.deleteMany({ where: { meetingId: id } })
      data.attendees = { create: rows }
      before.attendees = current.attendees.length
      after.attendees = rows.length
    }

    if (Object.keys(data).length === 0) return presentMeeting(current)

    const updated = await tx.salesMeeting.update({ where: { id }, data, include: INCLUDE })
    await writeAudit(tx, {
      entity: "SALES_MEETING",
      entityId: id,
      action: "UPDATE",
      changedBy: actor.sub,
      before: before as Prisma.InputJsonObject,
      after: after as Prisma.InputJsonObject,
    })
    if (moving) {
      await emitEvent(tx, {
        type: "sales.meeting.rescheduled",
        entity: "SALES_ACCOUNT",
        entityId: current.salesAccountId,
        actorUserId: actor.sub,
        subjectEmployeeId: current.salesAccount.ownerEmployeeId,
        managerEmployeeId: null,
        title: `Meeting moved: ${updated.title}`,
        meta: `${whenLabel(current.scheduledAt)} to ${whenLabel(updated.scheduledAt)}`,
        href: `/accounts/${current.salesAccountId}`,
      })
    }
    return presentMeeting(updated)
  })
}

/**
 * Completed, Cancelled, or back to Scheduled.
 *
 * A completed meeting is final: it cannot be reopened or cancelled, and a
 * later correction goes in its notes. A cancelled one can be put back, and
 * must be before it can be completed. Cancelling needs a reason; completing
 * takes an optional outcome (full minutes arrive in phase 4).
 */
export async function changeMeetingStatus(
  id: string,
  body: ChangeMeetingStatusBody,
  actor: AccessTokenPayload
): Promise<SalesMeetingSummary> {
  return prisma.$transaction(async (tx) => {
    const current = await meetingForWrite(tx, id, actor)
    if (current.status === body.status) {
      throw new AppError(400, `This meeting is already ${MEETING_STATUS_LABEL[body.status].toLowerCase()}`)
    }
    if (current.status === "COMPLETED") {
      throw new AppError(
        400,
        "A completed meeting cannot be reopened or cancelled. Add a correction to its notes instead."
      )
    }
    if (body.status === "COMPLETED" && current.status === "CANCELLED") {
      throw new AppError(400, "Put the meeting back to scheduled before completing it")
    }

    const data: Prisma.SalesMeetingUncheckedUpdateInput =
      body.status === "COMPLETED"
        ? { status: "COMPLETED", outcome: body.outcome ?? null, completedAt: new Date() }
        : body.status === "CANCELLED"
          ? { status: "CANCELLED", cancelReason: body.reason }
          : { status: "SCHEDULED", cancelReason: null }

    const updated = await tx.salesMeeting.update({ where: { id }, data, include: INCLUDE })
    await writeAudit(tx, {
      entity: "SALES_MEETING",
      entityId: id,
      action: "UPDATE",
      changedBy: actor.sub,
      before: { status: current.status },
      after: {
        status: body.status,
        ...(body.status === "COMPLETED" ? { outcome: body.outcome ?? null } : {}),
        ...(body.status === "CANCELLED" ? { cancelReason: body.reason } : {}),
      },
    })
    const type =
      body.status === "COMPLETED"
        ? ("sales.meeting.completed" as const)
        : body.status === "CANCELLED"
          ? ("sales.meeting.cancelled" as const)
          : ("sales.meeting.scheduled" as const)
    const title =
      body.status === "COMPLETED"
        ? `Meeting completed: ${updated.title}`
        : body.status === "CANCELLED"
          ? `Meeting cancelled: ${updated.title}`
          : `Meeting back on: ${updated.title}`
    await emitEvent(tx, {
      type,
      entity: "SALES_ACCOUNT",
      entityId: current.salesAccountId,
      actorUserId: actor.sub,
      subjectEmployeeId: current.salesAccount.ownerEmployeeId,
      managerEmployeeId: null,
      title,
      meta:
        body.status === "CANCELLED"
          ? body.reason
          : body.status === "COMPLETED"
            ? (body.outcome ?? whenLabel(updated.scheduledAt))
            : whenLabel(updated.scheduledAt),
      href: `/accounts/${current.salesAccountId}`,
    })
    return presentMeeting(updated)
  })
}

/** Any hub member may read a meeting, as they may read its account. */
export async function getMeeting(id: string, actor: AccessTokenPayload): Promise<SalesMeetingSummary> {
  const [meeting, employeeId] = await Promise.all([
    prisma.salesMeeting.findFirst({ where: { id }, include: INCLUDE }),
    employeeIdFor(actor),
  ])
  if (!meeting) throw new AppError(404, MEETING_NOT_VISIBLE)
  return presentMeeting(meeting, canManageMeeting(meeting, actor, employeeId))
}

/**
 * Meetings in time order. `mine` is the meetings I attend on our side, which
 * is what the 00:01 email is built from too.
 */
export async function listMeetings(
  query: ListMeetingQuery,
  actor: AccessTokenPayload
): Promise<{ items: SalesMeetingSummary[] }> {
  const employeeId = await employeeIdFor(actor)
  const where: Prisma.SalesMeetingWhereInput = {
    ...(query.salesAccountId ? { salesAccountId: query.salesAccountId } : {}),
    ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.from || query.to
      ? {
          scheduledAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lt: new Date(query.to) } : {}),
          },
        }
      : {}),
    ...(query.mine
      ? { attendees: { some: { side: "OURS" as const, employeeId: employeeId ?? "__none__" } } }
      : {}),
  }
  const rows = await prisma.salesMeeting.findMany({
    where,
    include: INCLUDE,
    orderBy: { scheduledAt: "asc" },
    take: 500,
  })
  return { items: rows.map((row) => presentMeeting(row, canManageMeeting(row, actor, employeeId))) }
}
