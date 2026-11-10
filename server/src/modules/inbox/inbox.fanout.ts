/**
 * Turning an event into per-person notifications.
 *
 * Called from `emitEvent`, inside the same transaction as the change, so a
 * notification can never announce a write that was rolled back. The rules
 * (`inbox.rules.ts`) say who; this file finds their user ids and writes rows.
 *
 * Closing: a decision closes every open Important row for the same request,
 * for every approver at once, so a leave approved by one HR Admin stops
 * counting for all of them. A few decisions emit no event at all (withdrawing
 * an expense claim, cancelling an asset request, rejecting a settlement, the
 * national ID decision); those services call `closeRequest` directly.
 */

import type { Event, Role } from "../../generated/prisma/client"
import type { EventTx } from "../event/event.types"
import { closeTargetFor, deliveriesFor, REQUEST_KINDS } from "./inbox.rules"
import type { Audience, CloseTarget, EventLike } from "./inbox.types"

const HR_ROLES: Role[] = ["HR_ADMIN", "SUPER_ADMIN"]

export async function closeRequest(tx: EventTx, target: CloseTarget): Promise<void> {
  if (target.entityIds.length === 0) return
  await tx.notification.updateMany({
    where: { entity: target.entity, entityId: { in: target.entityIds }, tab: "IMPORTANT", closedAt: null },
    data: { closedAt: new Date() },
  })
}

async function userOfEmployee(tx: EventTx, employeeId: string | null): Promise<string[]> {
  if (!employeeId) return []
  const employee = await tx.employee.findUnique({ where: { id: employeeId }, select: { userId: true } })
  return employee ? [employee.userId] : []
}

async function usersWithRoles(tx: EventTx, roles: Role[]): Promise<string[]> {
  if (roles.length === 0) return []
  const users = await tx.user.findMany({ where: { role: { in: roles }, isActive: true }, select: { id: true } })
  return users.map((u) => u.id)
}

/** Audience → user ids. Not yet filtered for active users or the actor. */
async function candidates(tx: EventTx, event: EventLike, audience: Audience): Promise<string[]> {
  switch (audience.kind) {
    case "subject":
      return userOfEmployee(tx, event.subjectEmployeeId)
    case "user":
      return [audience.userId]
    case "roles":
      return usersWithRoles(tx, audience.roles)
    case "managerOrHr":
      return event.managerEmployeeId
        ? userOfEmployee(tx, event.managerEmployeeId)
        : usersWithRoles(tx, HR_ROLES)
    case "attendanceOwners": {
      if (audience.attendanceIds.length === 0) return []
      const records = await tx.attendance.findMany({
        where: { id: { in: audience.attendanceIds } },
        select: { employee: { select: { userId: true } } },
      })
      return records.map((r) => r.employee.userId)
    }
    case "meetingAttendees": {
      const attendees = await tx.salesMeetingAttendee.findMany({
        where: { meetingId: audience.meetingId, side: "OURS", employeeId: { not: null } },
        select: { employee: { select: { userId: true } } },
      })
      return attendees.flatMap((a) => (a.employee ? [a.employee.userId] : []))
    }
    case "eventAudience": {
      if (event.companyWide) {
        const users = await tx.user.findMany({ where: { isActive: true }, select: { id: true } })
        return users.map((u) => u.id)
      }
      const found: string[] = []
      if (event.audienceDepartmentId) {
        const users = await tx.user.findMany({
          where: { isActive: true, employee: { departmentId: event.audienceDepartmentId } },
          select: { id: true },
        })
        found.push(...users.map((u) => u.id))
      }
      found.push(...(await usersWithRoles(tx, event.targetRoles)))
      return found
    }
  }
}

/** Audience → active user ids, with the actor removed and no repeats. */
export async function resolveUserIds(tx: EventTx, event: EventLike, audience: Audience): Promise<string[]> {
  const ids = [...new Set(await candidates(tx, event, audience))].filter((id) => id !== event.actorUserId)
  if (ids.length === 0) return []
  const active = await tx.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } })
  return active.map((u) => u.id)
}

function visibleFrom(event: EventLike): Date | undefined {
  if (event.type !== "announcement.published") return undefined
  const at =
    event.payload && typeof event.payload === "object"
      ? (event.payload as Record<string, unknown>).publishAt
      : undefined
  return typeof at === "string" ? new Date(at) : undefined
}

export async function fanOutEvent(tx: EventTx, event: Event): Promise<void> {
  const like: EventLike = event

  const close = closeTargetFor(like)
  if (close) await closeRequest(tx, close)
  // A request sent again for the same thing (an edited claim, a settlement
  // worked out again) replaces the copy that is still waiting.
  if (REQUEST_KINDS.has(event.type)) {
    await closeRequest(tx, { entity: event.entity, entityIds: [event.entityId] })
  }

  const from = visibleFrom(like)
  for (const delivery of deliveriesFor(like)) {
    const userIds = await resolveUserIds(tx, like, delivery.audience)
    if (userIds.length === 0) continue
    await tx.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        tab: delivery.tab,
        kind: event.type,
        eventId: event.id,
        entity: event.entity,
        entityId: event.entityId,
        title: event.title,
        meta: event.meta,
        href: event.href,
        ...(from ? { visibleFrom: from } : {}),
      })),
      skipDuplicates: true,
    })
  }
}
