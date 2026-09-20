/**
 * Meeting minutes: the written record of a completed meeting, sent to the
 * customer (revision §25).
 *
 * Minutes hang off one meeting and inherit its account. The people who work
 * the account (its owner and collaborators) and Sales Admins write and read
 * them; anyone else in the hub sees only that they exist, on the meeting's
 * row (§25.27). So every read and write here goes through the account scope,
 * and a refusal uses the words a missing document gets.
 *
 * The header is read live from the meeting, never copied (§25.4). Each copy
 * downloaded for sending is the frozen version.
 */

import { env } from "../../config/env"
import prisma from "../../config/prisma"
import type { Prisma } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import { parseDateOnly } from "../../utils/dates"
import type { AccessTokenPayload } from "../auth/auth.types"
import { emitEvent } from "../event/event.emit"
import { standingOf } from "./accounts/account.service"
import { resolveNames } from "./accounts/history.present"
import { MEETING_NOT_VISIBLE } from "./meetings/meeting.service"
import { cleanContent, readContent, sectionsFromTemplate, type SectionContent, type TableRow } from "./minutes.content"
import { dayLabel, headerLines, minutesFileName, type MinutesDocument } from "./minutes.pdf"
import { templateForNewMinutes } from "./minutes.template.service"
import { accountScopeFor, employeeIdFor } from "./sales.access"
import { canWorkAccounts } from "./sales.eligibility"
import type { SalesMinutesDetail, SalesMinutesListItem } from "./sales.types"
import type { ListMinutesQuery, SaveMinutesBody } from "./sales.validators"
import { createTaskIn } from "./tasks/task.service"

export const MINUTES_NOT_VISIBLE = "Those minutes do not exist, or are not yours"

const asClient = (tx: Prisma.TransactionClient) => tx as unknown as typeof prisma

const DETAIL_INCLUDE = {
  meeting: {
    include: {
      salesAccount: { select: { name: true, ownerEmployeeId: true } },
      opportunity: { select: { serial: true, name: true } },
      attendees: {
        include: {
          employee: { select: { fullName: true, designation: true } },
          contact: { select: { name: true, designation: true } },
        },
      },
      originated: { select: { id: true, serial: true, name: true } },
    },
  },
  sections: { orderBy: { order: "asc" as const } },
  preparers: {
    orderBy: { order: "asc" as const },
    include: { employee: { select: { fullName: true, designation: true } } },
  },
  sends: { orderBy: { sentAt: "desc" as const } },
} satisfies Prisma.SalesMeetingMinutesInclude

export type MinutesRow = Prisma.SalesMeetingMinutesGetPayload<{ include: typeof DETAIL_INCLUDE }>

/** What History says for a row written before notes were kept, or with none. */
const HISTORY_TEXT: Record<string, string> = {
  CREATE: "Minutes started",
  UPDATE: "Minutes edited",
  SEND: "Minutes sent",
  DELETE: "Minutes deleted",
}

/** The accounts a caller works, as a filter on minutes. The read gate and the write gate are one (§25.27). */
function scopeFor(actor: AccessTokenPayload, employeeId: string | null): Prisma.SalesMeetingMinutesWhereInput {
  return { meeting: { salesAccount: accountScopeFor(actor, employeeId) } }
}

export async function loadMinutes(
  client: Prisma.TransactionClient,
  id: string,
  actor: AccessTokenPayload,
  employeeId: string | null
): Promise<MinutesRow> {
  const row = await client.salesMeetingMinutes.findFirst({
    where: { id, ...scopeFor(actor, employeeId) },
    include: DETAIL_INCLUDE,
  })
  if (!row) throw new AppError(404, MINUTES_NOT_VISIBLE)
  return row
}

const blankToNull = (value: string | null | undefined) => value?.trim() || null

/** A date the user picked, refused as a 400 rather than a 500 when it is not on the calendar. */
function dueDate(value: string): Date {
  try {
    return parseDateOnly(value)
  } catch {
    throw new AppError(400, `${value} is not a date on the calendar`)
  }
}

// ── the document ─────────────────────────────────────────────────────────────

/**
 * Who came, from the meeting. Our side's title is their HR job title; their
 * side's is the saved contact's, or what was typed for somebody not saved.
 */
function attendeesOf(row: MinutesRow): MinutesDocument["attendees"] {
  return row.meeting.attendees.map((attendee) => ({
    side: attendee.side,
    name: attendee.employee?.fullName ?? attendee.contact?.name ?? attendee.name ?? "",
    designation:
      attendee.side === "OURS"
        ? (attendee.employee?.designation ?? null)
        : (attendee.contact?.designation ?? attendee.designation ?? null),
  }))
}

function preparersOf(row: MinutesRow): SalesMinutesDetail["preparers"] {
  return row.preparers.map((preparer) => ({
    employeeId: preparer.employeeId,
    name: preparer.employee.fullName,
    title: preparer.employee.designation ?? null,
    titleExtra: preparer.titleExtra ?? null,
  }))
}

function sectionsOf(row: MinutesRow): SalesMinutesDetail["sections"] {
  return row.sections.map((section) => ({
    heading: section.heading,
    kind: section.kind,
    content: readContent(section.kind, section.content),
  }))
}

/** Everything the PDF prints, read from the minutes and, live, from their meeting. */
export function documentOf(row: MinutesRow, arrangedBy: string | null): MinutesDocument {
  const meeting = row.meeting
  return {
    accountName: meeting.salesAccount.name,
    meetingTitle: meeting.title,
    scheduledAt: meeting.scheduledAt,
    endsAt: meeting.endsAt,
    mode: meeting.mode,
    location: meeting.location,
    meetingWithNote: row.meetingWithNote,
    arrangedBy,
    purpose: row.purpose,
    attendees: attendeesOf(row),
    sections: sectionsOf(row),
    preparers: preparersOf(row).map((p) => ({ name: p.name, title: p.title, extra: p.titleExtra })),
  }
}

/**
 * Names for everyone the document mentions by user id: whoever arranged the
 * meeting, whoever sent each copy, and whoever wrote each History line. One
 * lookup for all of them.
 */
export async function namesFor(row: MinutesRow, changedBy: (string | null)[] = []): Promise<Map<string, string>> {
  return resolveNames(
    [row.meeting.createdBy, ...row.sends.map((send) => send.sentBy), ...changedBy].map((userId) => ({
      before: null,
      after: null,
      changedBy: userId,
    }))
  )
}

async function detailOf(row: MinutesRow): Promise<SalesMinutesDetail> {
  const audits = await prisma.auditLog.findMany({
    where: { entity: "SALES_MINUTES", entityId: row.id },
    orderBy: { changedAt: "desc" },
    take: 100,
  })
  const names = await namesFor(row, audits.map((audit) => audit.changedBy))
  const name = (userId: string | null) => (userId ? (names.get(userId) ?? null) : null)
  const doc = documentOf(row, name(row.meeting.createdBy))
  const meeting = row.meeting

  return {
    id: row.id,
    meetingId: row.meetingId,
    status: row.status,
    lastSentAt: row.lastSentAt?.toISOString() ?? null,
    purpose: row.purpose,
    meetingWithNote: row.meetingWithNote,
    requirementFound: row.requirementFound,
    // Asked only when no deal is linked (§25.6), and fixed after the first send.
    asksRequirement: meeting.opportunityId === null,
    requirementLocked: row.lastSentAt !== null,
    title: `Meeting Minutes – ${doc.accountName}`,
    subtitle: doc.meetingTitle,
    header: headerLines(doc, { companyName: env.COMPANY_NAME, timeZone: env.APP_TIMEZONE }),
    fileName: minutesFileName(doc.accountName, doc.scheduledAt, env.APP_TIMEZONE),
    companyName: env.COMPANY_NAME,
    meeting: {
      id: meeting.id,
      title: meeting.title,
      scheduledAt: meeting.scheduledAt.toISOString(),
      endsAt: meeting.endsAt?.toISOString() ?? null,
      status: meeting.status,
      salesAccountId: meeting.salesAccountId,
      salesAccountName: meeting.salesAccount.name,
      opportunityId: meeting.opportunityId,
      opportunitySerial: meeting.opportunity?.serial ?? null,
      opportunityName: meeting.opportunity?.name ?? null,
    },
    attendees: doc.attendees,
    sections: sectionsOf(row),
    preparers: preparersOf(row),
    sends: row.sends.map((send) => ({
      id: send.id,
      sentAt: send.sentAt.toISOString(),
      sentByName: name(send.sentBy),
      sentTo: send.sentTo,
      fileName: send.fileName,
    })),
    history: audits.map((audit) => ({
      id: audit.id,
      at: audit.changedAt.toISOString(),
      byName: name(audit.changedBy),
      text: audit.note ?? HISTORY_TEXT[audit.action] ?? audit.action,
    })),
    originatedDeals: meeting.originated.map((deal) => ({ id: deal.id, serial: deal.serial, name: deal.name })),
    // A sent document stays as a record (§25.9).
    canDelete: row.lastSentAt === null && row.sends.length === 0,
  }
}

// ── writing ──────────────────────────────────────────────────────────────────

/**
 * Starts the minutes of a completed meeting (§25.3), from the template, with
 * the meeting's outcome note in the section marked for it (§25.1) and the
 * writer under Prepared by (§25.7). Starting twice opens the same document.
 */
export async function startMinutes(meetingId: string, actor: AccessTokenPayload): Promise<{ id: string; created: boolean }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const employeeId = await employeeIdFor(actor, asClient(tx))
      const meeting = await tx.salesMeeting.findFirst({
        where: { id: meetingId, salesAccount: accountScopeFor(actor, employeeId) },
        include: {
          salesAccount: { select: { name: true, ownerEmployeeId: true } },
          minutes: { select: { id: true } },
        },
      })
      if (!meeting) throw new AppError(404, MEETING_NOT_VISIBLE)
      if (meeting.minutes) return { id: meeting.minutes.id, created: false }
      if (meeting.status !== "COMPLETED") {
        throw new AppError(400, "Minutes are written for a meeting that has happened. Mark it completed first.")
      }

      const sections = sectionsFromTemplate(await templateForNewMinutes(asClient(tx)), meeting.outcome)
      const created = await tx.salesMeetingMinutes.create({
        data: {
          meetingId: meeting.id,
          createdBy: actor.sub,
          updatedBy: actor.sub,
          sections: {
            create: sections.map((section) => ({
              order: section.order,
              heading: section.heading,
              kind: section.kind,
              content: section.content as Prisma.InputJsonObject,
            })),
          },
          // A Super Admin has no employee record, so nobody is named yet.
          ...(employeeId ? { preparers: { create: [{ employeeId, order: 0 }] } } : {}),
        },
        select: { id: true },
      })

      await writeAudit(tx, {
        entity: "SALES_MINUTES",
        entityId: created.id,
        action: "CREATE",
        changedBy: actor.sub,
        after: { meetingId: meeting.id, sections: sections.map((section) => section.heading).join(", ") },
        note: "Minutes started",
      })
      // Against the account, as every meeting event is, so its Timeline and a
      // linked deal's (through the payload) say so without a second event.
      // Nobody is emailed or rung (§25.34).
      await emitEvent(tx, {
        type: "sales.minutes.written",
        entity: "SALES_ACCOUNT",
        entityId: meeting.salesAccountId,
        actorUserId: actor.sub,
        subjectEmployeeId: meeting.salesAccount.ownerEmployeeId,
        managerEmployeeId: null,
        title: `Minutes written: ${meeting.title}`,
        meta: `Meeting on ${dayLabel(meeting.scheduledAt, env.APP_TIMEZONE)}`,
        href: `/accounts/${meeting.salesAccountId}`,
        payload: { meetingId: meeting.id, opportunityId: meeting.opportunityId, minutesId: created.id },
      })
      return { id: created.id, created: true }
    })
  } catch (err) {
    // Two starts at the same moment: the second meets the one-per-meeting rule
    // and opens the first rather than failing.
    if ((err as { code?: string }).code === "P2002") {
      const existing = await prisma.salesMeetingMinutes.findUnique({ where: { meetingId }, select: { id: true } })
      if (existing) return { id: existing.id, created: false }
    }
    throw err
  }
}

export async function getMinutes(id: string, actor: AccessTokenPayload): Promise<SalesMinutesDetail> {
  const employeeId = await employeeIdFor(actor)
  return detailOf(await loadMinutes(prisma, id, actor, employeeId))
}

/**
 * Anyone newly named under Prepared by must be able to work in the hub, the
 * rule for an attendee. Those already on the document are not checked again:
 * somebody who has since left still prepared these minutes.
 */
async function checkNewPreparers(tx: Prisma.TransactionClient, ids: string[]) {
  if (ids.length === 0) return
  const people = await tx.employee.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      fullName: true,
      employmentStatus: true,
      lastWorkingDay: true,
      user: { select: { salesRole: true, isActive: true } },
    },
  })
  const byId = new Map(people.map((person) => [person.id, person]))
  for (const id of ids) {
    const person = byId.get(id)
    if (!person) throw new AppError(400, "Somebody under Prepared by is not an employee")
    if (!canWorkAccounts(standingOf(person))) {
      throw new AppError(400, `${person.fullName} cannot be named under Prepared by: they do not have Sales Hub access`)
    }
  }
}

/**
 * Saves the whole document as the editor sends it: the last save wins, and
 * History has a line for each (§25.8, §25.35).
 *
 * A ticked Next Steps row makes one task for the writer, linked to the
 * meeting, and remembers it (§25.5). A task id is kept only if this document
 * already had it, so the page cannot attach somebody else's task to a row.
 */
export async function saveMinutes(id: string, body: SaveMinutesBody, actor: AccessTokenPayload): Promise<SalesMinutesDetail> {
  await prisma.$transaction(async (tx) => {
    const employeeId = await employeeIdFor(actor, asClient(tx))
    const current = await loadMinutes(tx, id, actor, employeeId)

    const preparers = body.preparers.filter(
      (preparer, index, all) => all.findIndex((p) => p.employeeId === preparer.employeeId) === index
    )
    const had = new Set(current.preparers.map((preparer) => preparer.employeeId))
    await checkNewPreparers(
      tx,
      preparers.map((preparer) => preparer.employeeId).filter((employee) => !had.has(employee))
    )

    const madeHere = new Set(
      current.sections.flatMap((section) =>
        section.kind === "TABLE"
          ? readContent("TABLE", section.content).rows.flatMap((row) => (row.taskId ? [row.taskId] : []))
          : []
      )
    )

    let tasksMade = 0
    const sections: { order: number; heading: string; kind: SalesMinutesDetail["sections"][number]["kind"]; content: SectionContent }[] = []
    for (const [order, section] of body.sections.entries()) {
      if (section.kind !== "TABLE") {
        sections.push({ order, heading: section.heading, kind: section.kind, content: cleanContent(section.kind, section.content) })
        continue
      }
      const rows: TableRow[] = []
      for (const row of section.content.rows) {
        let taskId = row.taskId && madeHere.has(row.taskId) ? row.taskId : null
        if (!taskId && row.newTask && row.actionItem.trim()) {
          const task = await createTaskIn(
            tx,
            {
              salesAccountId: current.meeting.salesAccountId,
              opportunityId: current.meeting.opportunityId,
              meetingId: current.meetingId,
              title: row.actionItem.trim().slice(0, 180),
              dueOn: dueDate(row.newTask.dueOn),
            },
            actor
          )
          taskId = task.id
          tasksMade += 1
        }
        rows.push({ actionItem: row.actionItem, responsible: row.responsible, status: row.status, taskId })
      }
      sections.push({ order, heading: section.heading, kind: "TABLE", content: cleanContent("TABLE", { rows }) })
    }

    await tx.salesMinutesSection.deleteMany({ where: { minutesId: id } })
    await tx.salesMinutesPreparer.deleteMany({ where: { minutesId: id } })
    await tx.salesMeetingMinutes.update({
      where: { id },
      data: {
        purpose: blankToNull(body.purpose),
        meetingWithNote: blankToNull(body.meetingWithNote),
        updatedBy: actor.sub,
        // The customer has an older copy, and the list says so (§25.28).
        ...(current.status === "SENT" ? { status: "EDITED_AFTER_SENDING" as const } : {}),
        sections: {
          create: sections.map((section) => ({ ...section, content: section.content as Prisma.InputJsonObject })),
        },
        preparers: {
          create: preparers.map((preparer, order) => ({
            employeeId: preparer.employeeId,
            titleExtra: blankToNull(preparer.titleExtra),
            order,
          })),
        },
      },
    })
    // One line per save, not a comparison word by word (§25.35).
    await writeAudit(tx, {
      entity: "SALES_MINUTES",
      entityId: id,
      action: "UPDATE",
      changedBy: actor.sub,
      after: { sections: sections.length, preparers: preparers.length, ...(tasksMade > 0 ? { tasksMade } : {}) },
      note: "Minutes edited",
    })
  })
  return getMinutes(id, actor)
}

/**
 * The requirement question (§25.6). Only for a meeting with no deal, and fixed
 * once the minutes are sent. The answer is recorded here; the deal or the
 * follow-up task it leads to is made by its own form.
 */
export async function answerRequirement(
  id: string,
  body: { found: boolean },
  actor: AccessTokenPayload
): Promise<SalesMinutesDetail> {
  await prisma.$transaction(async (tx) => {
    const employeeId = await employeeIdFor(actor, asClient(tx))
    const current = await loadMinutes(tx, id, actor, employeeId)
    if (current.meeting.opportunityId) {
      throw new AppError(400, "This meeting already has a deal, so there is nothing to ask")
    }
    if (current.lastSentAt) {
      throw new AppError(400, "The answer is fixed once the minutes have been sent")
    }
    // The same answer again (a second press, a second tab) changes nothing,
    // so it saves nothing and History gets no second line.
    if (current.requirementFound === body.found) return
    await tx.salesMeetingMinutes.update({ where: { id }, data: { requirementFound: body.found, updatedBy: actor.sub } })
    await writeAudit(tx, {
      entity: "SALES_MINUTES",
      entityId: id,
      action: "UPDATE",
      changedBy: actor.sub,
      before: { requirementFound: current.requirementFound },
      after: { requirementFound: body.found },
      note: body.found ? "Requirement found" : "No requirement found",
    })
  })
  return getMinutes(id, actor)
}

/** Only before the first send; after that the document stays as a record (§25.9). */
export async function deleteMinutes(id: string, actor: AccessTokenPayload): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const employeeId = await employeeIdFor(actor, asClient(tx))
    const current = await loadMinutes(tx, id, actor, employeeId)
    if (current.lastSentAt || current.sends.length > 0) {
      throw new AppError(400, "Minutes that have been sent stay as a record, so they cannot be deleted")
    }
    await tx.salesMeetingMinutes.delete({ where: { id } })
    await writeAudit(tx, {
      entity: "SALES_MINUTES",
      entityId: id,
      action: "DELETE",
      changedBy: actor.sub,
      before: { meetingId: current.meetingId },
      note: "Minutes deleted",
    })
  })
}

// ── the list ─────────────────────────────────────────────────────────────────

const LIST_INCLUDE = {
  meeting: { select: { title: true, scheduledAt: true, salesAccountId: true, salesAccount: { select: { name: true } } } },
  preparers: { orderBy: { order: "asc" as const }, select: { employee: { select: { fullName: true } } } },
} satisfies Prisma.SalesMeetingMinutesInclude

/**
 * Every document the caller may read, newest meeting first (§25.28). Mine
 * only is the minutes they started or are named under Prepared by.
 */
export async function listMinutes(
  query: { mine?: boolean; status?: ListMinutesQuery["status"] },
  actor: AccessTokenPayload
): Promise<{ items: SalesMinutesListItem[] }> {
  const employeeId = await employeeIdFor(actor)
  const rows = await prisma.salesMeetingMinutes.findMany({
    where: {
      ...scopeFor(actor, employeeId),
      ...(query.status ? { status: query.status } : {}),
      ...(query.mine
        ? { OR: [{ createdBy: actor.sub }, { preparers: { some: { employeeId: employeeId ?? "__none__" } } }] }
        : {}),
    },
    include: LIST_INCLUDE,
    orderBy: { meeting: { scheduledAt: "desc" } },
    take: 500,
  })
  return {
    items: rows.map((row) => ({
      id: row.id,
      meetingId: row.meetingId,
      meetingTitle: row.meeting.title,
      scheduledAt: row.meeting.scheduledAt.toISOString(),
      salesAccountId: row.meeting.salesAccountId,
      salesAccountName: row.meeting.salesAccount.name,
      preparedBy: row.preparers.map((preparer) => preparer.employee.fullName),
      status: row.status,
      lastSentAt: row.lastSentAt?.toISOString() ?? null,
    })),
  }
}
