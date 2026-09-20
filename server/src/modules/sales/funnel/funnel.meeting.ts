/**
 * The Saturday review itself (revision §27.11, §27.12).
 *
 * The meeting is the only thing the funnel actually stores. The grid is a view
 * over deals; this is the record of the room — when it happened, who was in
 * it, and whose funnel got walked.
 *
 * Admin only, throughout. Nothing here is offered to a Sales User.
 */

import prisma from "../../../config/prisma"
import { Prisma } from "../../../generated/prisma/client"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import { formatDateOnly, parseDateOnly } from "../../../utils/dates"
import { officeDateOf } from "../../attendance/attendance.time"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { emitEvent } from "../../event/event.emit"
import { employeeIdFor, isSalesAdmin } from "../sales.access"
import { meetingSaturdayFor, weekReviewedBy } from "./funnel.dates"

export const ADMIN_ONLY = "Only a Sales Admin can run a funnel meeting"
export const MEETING_NOT_FOUND = "That funnel meeting does not exist"
export const MEETING_CLOSED = "That funnel meeting is completed. Reopen it to make changes"
export const NEEDS_EMPLOYEE = "A Sales Admin needs an employee record to run a meeting"
export const UNKNOWN_PEOPLE = "One or more of those people do not exist"
export const UNKNOWN_PERSON = "That person does not exist"

export interface FunnelMeetingDetail {
  id: string
  weekStart: string
  heldOn: string
  status: "SCHEDULED" | "COMPLETED"
  ranByEmployeeId: string
  ranByName: string
  note: string | null
  attendees: { employeeId: string; employeeName: string }[]
  reviewed: { employeeId: string; employeeName: string; reviewedAt: string }[]
  actionItemCount: number
}

const DETAIL = {
  id: true,
  weekStart: true,
  heldOn: true,
  status: true,
  ranByEmployeeId: true,
  ranBy: { select: { fullName: true } },
  note: true,
  attendees: { select: { employeeId: true, employee: { select: { fullName: true } } } },
  reviews: {
    select: { employeeId: true, reviewedAt: true, employee: { select: { fullName: true } } },
    orderBy: { reviewedAt: "asc" },
  },
  _count: { select: { tasks: true } },
} as const

interface DetailRow {
  id: string
  weekStart: Date
  heldOn: Date
  status: "SCHEDULED" | "COMPLETED"
  ranByEmployeeId: string
  ranBy: { fullName: string }
  note: string | null
  attendees: { employeeId: string; employee: { fullName: string } }[]
  reviews: { employeeId: string; reviewedAt: Date; employee: { fullName: string } }[]
  _count: { tasks: number }
}

function present(row: DetailRow): FunnelMeetingDetail {
  return {
    id: row.id,
    weekStart: formatDateOnly(row.weekStart),
    heldOn: formatDateOnly(row.heldOn),
    status: row.status,
    ranByEmployeeId: row.ranByEmployeeId,
    ranByName: row.ranBy.fullName,
    note: row.note,
    attendees: row.attendees.map((a) => ({
      employeeId: a.employeeId,
      employeeName: a.employee.fullName,
    })),
    reviewed: row.reviews.map((r) => ({
      employeeId: r.employeeId,
      employeeName: r.employee.fullName,
      reviewedAt: r.reviewedAt.toISOString(),
    })),
    actionItemCount: row._count.tasks,
  }
}

function requireAdmin(actor: AccessTokenPayload) {
  if (!isSalesAdmin(actor)) throw new AppError(403, ADMIN_ONLY)
}

/**
 * Opens the review for a week, or hands back the one already open.
 *
 * `weekStart` is unique, so asking twice is not an error — it is the second
 * person pressing the same button, and they should land in the same meeting
 * rather than be told off.
 */
export async function openFunnelMeeting(
  body: { weekStart?: string; heldOn?: string },
  actor: AccessTokenPayload,
  now: Date = new Date()
): Promise<FunnelMeetingDetail> {
  requireAdmin(actor)

  const employeeId = await employeeIdFor(actor)
  if (!employeeId) throw new AppError(409, NEEDS_EMPLOYEE)

  // The office's own date, not the UTC one: at 03:00 in Dhaka on a Saturday
  // the UTC date is still Friday, which is the week before.
  const today = officeDateOf(now)
  const weekStart = body.weekStart ? parseDateOnly(body.weekStart) : weekReviewedBy(today)
  const heldOn = body.heldOn ? parseDateOnly(body.heldOn) : today

  const existing = await prisma.funnelMeeting.findUnique({ where: { weekStart }, select: DETAIL })
  if (existing) return present(existing as DetailRow)

  try {
    const created = await prisma.$transaction(async (tx) => {
      const meeting = await tx.funnelMeeting.create({
        data: { weekStart, heldOn, ranByEmployeeId: employeeId, createdBy: actor.sub },
        select: DETAIL,
      })

      await writeAudit(tx, {
        entity: "FUNNEL_MEETING",
        entityId: meeting.id,
        action: "CREATE",
        changedBy: actor.sub,
        after: { weekStart: formatDateOnly(weekStart), heldOn: formatDateOnly(heldOn) },
      })

      await emitEvent(tx, {
        type: "sales.funnel.meeting_opened",
        entity: "FUNNEL_MEETING",
        entityId: meeting.id,
        actorUserId: actor.sub,
        // The admin who ran it is the subject: the event is about what they
        // did, and it gives the row a real audience. `managerEmployeeId: null`
        // stops it travelling up a reporting line that has no part in the
        // funnel (§27.16).
        subjectEmployeeId: employeeId,
        managerEmployeeId: null,
        title: `Funnel meeting opened for the week of ${formatDateOnly(weekStart)}`,
        meta: null,
        href: "/sales/funnel",
      })

      return meeting
    })

    return present(created as DetailRow)
  } catch (err) {
    // Two admins pressing the button in the same instant both pass the check
    // above; the unique week key lets one through and refuses the other. The
    // loser should land in the winner's meeting, as the comment promises,
    // rather than see a 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await prisma.funnelMeeting.findUnique({ where: { weekStart }, select: DETAIL })
      if (winner) return present(winner as DetailRow)
    }
    throw err
  }
}

/** The meeting for a week, if one has been opened. */
export async function getFunnelMeeting(
  weekStart: string | undefined,
  actor: AccessTokenPayload,
  now: Date = new Date()
): Promise<FunnelMeetingDetail | null> {
  requireAdmin(actor)
  const week = weekStart ? parseDateOnly(weekStart) : weekReviewedBy(officeDateOf(now))
  const row = await prisma.funnelMeeting.findUnique({ where: { weekStart: week }, select: DETAIL })
  return row ? present(row as DetailRow) : null
}

/**
 * Locks the meeting for the rest of the transaction, then reads it.
 *
 * Checking that a meeting is open and then writing to it are two steps, and
 * "complete the meeting" can land between them: a note or an action item
 * would arrive on a meeting that had just been closed. The row lock makes the
 * check and the write one step. Every writer here takes it, so they queue.
 */
export async function lockMeeting(
  tx: Prisma.TransactionClient,
  id: string,
  { open }: { open: boolean }
) {
  await tx.$queryRaw`SELECT "id" FROM "FunnelMeeting" WHERE "id" = ${id} FOR UPDATE`
  const meeting = await tx.funnelMeeting.findUnique({
    where: { id },
    select: { id: true, status: true, weekStart: true, ranByEmployeeId: true, note: true },
  })
  if (!meeting) throw new AppError(404, MEETING_NOT_FOUND)
  // A completed meeting takes no new work (§27.11).
  if (open && meeting.status === "COMPLETED") throw new AppError(409, MEETING_CLOSED)
  return meeting
}

const sorted = (ids: string[]) => [...ids].sort()

/**
 * Ticks who was in the room. The whole list is sent, so unticking is simply a
 * shorter list — there is no separate remove call to forget to make.
 */
export async function setMeetingAttendees(
  id: string,
  body: { employeeIds: string[] },
  actor: AccessTokenPayload
): Promise<FunnelMeetingDetail> {
  requireAdmin(actor)
  const employeeIds = [...new Set(body.employeeIds)]

  const row = await prisma.$transaction(async (tx) => {
    await lockMeeting(tx, id, { open: true })

    // A stranger's id would be a foreign-key error, which is a 500.
    if (employeeIds.length > 0) {
      const known = await tx.employee.findMany({
        where: { id: { in: employeeIds } },
        select: { id: true },
      })
      if (known.length !== employeeIds.length) throw new AppError(400, UNKNOWN_PEOPLE)
    }

    const before = await tx.funnelMeetingAttendee.findMany({
      where: { funnelMeetingId: id },
      select: { employeeId: true },
    })

    await tx.funnelMeetingAttendee.deleteMany({ where: { funnelMeetingId: id } })
    if (employeeIds.length > 0) {
      await tx.funnelMeetingAttendee.createMany({
        data: employeeIds.map((employeeId) => ({ funnelMeetingId: id, employeeId })),
        skipDuplicates: true,
      })
    }

    await writeAudit(tx, {
      entity: "FUNNEL_MEETING",
      entityId: id,
      action: "UPDATE",
      changedBy: actor.sub,
      before: { attendees: sorted(before.map((a) => a.employeeId)) },
      after: { attendees: sorted(employeeIds) },
      note: "Attendees changed",
    })

    return tx.funnelMeeting.findUniqueOrThrow({ where: { id }, select: DETAIL })
  })

  return present(row as DetailRow)
}

/**
 * Marks one person's funnel as walked, or takes the mark back off.
 *
 * Kept apart from attendance on purpose (§27.3): somebody can be away and
 * their deals still reviewed, and somebody can sit through the whole meeting
 * without their own funnel being opened.
 */
export async function setPersonReviewed(
  id: string,
  body: { employeeId: string; reviewed: boolean },
  actor: AccessTokenPayload
): Promise<FunnelMeetingDetail> {
  requireAdmin(actor)

  const row = await prisma.$transaction(async (tx) => {
    await lockMeeting(tx, id, { open: true })

    const person = await tx.employee.findUnique({
      where: { id: body.employeeId },
      select: { id: true },
    })
    if (!person) throw new AppError(404, UNKNOWN_PERSON)

    if (body.reviewed) {
      await tx.funnelMeetingReview.upsert({
        where: { funnelMeetingId_employeeId: { funnelMeetingId: id, employeeId: body.employeeId } },
        create: { funnelMeetingId: id, employeeId: body.employeeId, reviewedBy: actor.sub },
        update: { reviewedAt: new Date(), reviewedBy: actor.sub },
      })
    } else {
      await tx.funnelMeetingReview.deleteMany({
        where: { funnelMeetingId: id, employeeId: body.employeeId },
      })
    }

    await writeAudit(tx, {
      entity: "FUNNEL_MEETING",
      entityId: id,
      action: "UPDATE",
      changedBy: actor.sub,
      after: { employeeId: body.employeeId, reviewed: body.reviewed },
      note: body.reviewed ? "Funnel marked reviewed" : "Reviewed mark taken off",
    })

    return tx.funnelMeeting.findUniqueOrThrow({ where: { id }, select: DETAIL })
  })

  return present(row as DetailRow)
}

/** The week's note. One note for the meeting, not one per person (§27.3). */
export async function setMeetingNote(
  id: string,
  body: { note: string | null },
  actor: AccessTokenPayload
): Promise<FunnelMeetingDetail> {
  requireAdmin(actor)

  const row = await prisma.$transaction(async (tx) => {
    const meeting = await lockMeeting(tx, id, { open: true })

    const updated = await tx.funnelMeeting.update({
      where: { id },
      data: { note: body.note },
      select: DETAIL,
    })

    // The note is the meeting's own record, so a change to it is audited like
    // any other. A save that changes nothing is not.
    if ((meeting.note ?? null) !== (body.note ?? null)) {
      await writeAudit(tx, {
        entity: "FUNNEL_MEETING",
        entityId: id,
        action: "UPDATE",
        changedBy: actor.sub,
        before: { note: meeting.note ?? null },
        after: { note: body.note ?? null },
        note: "Week note changed",
      })
    }
    return updated
  })

  return present(row as DetailRow)
}

/**
 * Completing and reopening (§27.11).
 *
 * Completing takes no new notes and no new action items, and **locks nothing
 * already written**. Reopening is ordinary rather than an exception — a
 * meeting gets completed and then somebody remembers something — which is why
 * the status is an enum and not a boolean: the audit log can then tell
 * "reopened" from "never completed".
 */
export async function setMeetingStatus(
  id: string,
  status: "SCHEDULED" | "COMPLETED",
  actor: AccessTokenPayload
): Promise<FunnelMeetingDetail> {
  requireAdmin(actor)

  const row = await prisma.$transaction(async (tx) => {
    const meeting = await lockMeeting(tx, id, { open: false })

    // Already there: a double click, or a second admin. Nothing changed, so
    // nothing is written — a fresh audit row saying "reopened" for a meeting
    // that was never completed would defeat the reason the status is an enum.
    if (meeting.status === status) {
      return tx.funnelMeeting.findUniqueOrThrow({ where: { id }, select: DETAIL })
    }

    const updated = await tx.funnelMeeting.update({
      where: { id },
      data: { status },
      select: DETAIL,
    })

    await writeAudit(tx, {
      entity: "FUNNEL_MEETING",
      entityId: id,
      action: "UPDATE",
      changedBy: actor.sub,
      before: { status: meeting.status },
      after: { status },
    })

    await emitEvent(tx, {
      type:
        status === "COMPLETED"
          ? "sales.funnel.meeting_completed"
          : "sales.funnel.meeting_reopened",
      entity: "FUNNEL_MEETING",
      entityId: id,
      actorUserId: actor.sub,
      // As above: the person who ran the meeting is the subject, and the
      // reporting line is deliberately not an audience for it.
      subjectEmployeeId: meeting.ranByEmployeeId,
      managerEmployeeId: null,
      title:
        status === "COMPLETED"
          ? `Funnel meeting for the week of ${formatDateOnly(meeting.weekStart)} completed`
          : `Funnel meeting for the week of ${formatDateOnly(meeting.weekStart)} reopened`,
      meta: null,
      href: "/sales/funnel",
    })

    return updated
  })

  return present(row as DetailRow)
}

/**
 * The Saturday a week's review is normally held on, for the interface to offer
 * as a default.
 */
export function suggestedHeldOn(weekStart: Date): string {
  return formatDateOnly(meetingSaturdayFor(weekStart))
}
