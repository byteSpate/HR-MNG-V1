/**
 * Reading and writing a Weekly Report (revision §26).
 *
 * The week itself is mostly a view: `weekly.compose.ts` builds it from what
 * the Sales Hub already records. This file loads those rows, writes the few
 * lines the report owns — Challenges, Gap, a next step for an account with no
 * deal, and Other work — and answers the admin's All Reports list.
 *
 * Only Sales Users write a report (§26.1). Sales Admins and Super Admin read
 * them; a Sales User reads their own.
 */

import { Prisma, Role, SalesRole } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import type { AccessTokenPayload } from "../auth/auth.types"
import { addDays, parseDateOnly } from "../../utils/dates"
import { officeToday } from "../attendance/attendance.time"
import { resolveShift } from "../attendance/attendance.grid"
import { writeAudit } from "../../utils/audit"
import { accountScopeFor, employeeIdFor } from "./sales.access"
import { composeWeek, type WeekView } from "./weekly.compose"
import { deadlineDayOf, isInWeek, saturdayBefore, weekEndOf, weekStartOf } from "./weekly.dates"

/** A task made from a typed next step starts a week out (plan choice 9). */
const TASK_DUE_DAYS = 7

const DEAL_CHANGE_EVENTS = [
  "sales.opportunity.created",
  "sales.opportunity.stage_changed",
  "sales.opportunity.next_step_changed",
  "sales.opportunity.won",
  "sales.opportunity.closed",
]

const NO_EMPLOYEE = "A weekly report belongs to an employee, and your login has no employee record"
const NOT_A_WRITER = "Only a Sales User writes a weekly report"
const NOT_A_READER = "Only a Sales Admin reads other people's weekly reports"
const ACCOUNT_NOT_YOURS = "That Sales Account does not exist, or is not yours"
const OTHER_WORK_NOT_FOUND = "That line does not exist, or is not yours"

type Client = typeof prisma

const asClient = (tx: Prisma.TransactionClient) => tx as unknown as Client

export type WeekStatus = "NOT_STARTED" | "DRAFT" | "SUBMITTED"

export interface MyWeek extends WeekView {
  status: WeekStatus
  deadlineDay: Date
  submittedLate: boolean
  firstSubmittedAt: Date | null
  lastSubmittedAt: Date | null
  copies: Array<{ id: string; submittedAt: Date; fileName: string }>
  person: { employeeId: string; fullName: string; designation: string }
}

export interface TeamWeekRow {
  employeeId: string
  fullName: string
  designation: string
  status: WeekStatus
  submittedLate: boolean
  firstSubmittedAt: Date | null
}

export interface WeekQuery {
  week?: string
}

export interface SaveAccountNoteBody {
  date: string
  salesAccountId: string
  challenges: string | null
  gap: string | null
  nextStep: string | null
  makeTask: boolean
}

export interface AddOtherWorkBody {
  date: string
  text: string
}

const isAdmin = (actor: AccessTokenPayload) =>
  actor.role === Role.SUPER_ADMIN || actor.salesRole === SalesRole.SALES_ADMIN

/** A date the person picked, refused as a 400 rather than a 500. */
function dateFrom(value: string): Date {
  try {
    return parseDateOnly(value)
  } catch {
    throw new AppError(400, `${value} is not a date on the calendar`)
  }
}

/** The week asked for, or the week of today. Never a week still to come. */
function weekFrom(query: WeekQuery): Date {
  const weekStart = query.week ? weekStartOf(dateFrom(query.week)) : weekStartOf(officeToday())
  if (weekStart.getTime() > weekStartOf(officeToday()).getTime()) {
    throw new AppError(400, "That week has not happened yet")
  }
  return weekStart
}

/** The writer: a Sales User with an employee record, and nobody else (§26.1). */
async function writerFor(actor: AccessTokenPayload, client: Client = prisma): Promise<string> {
  if (actor.salesRole !== SalesRole.SALES_USER) throw new AppError(403, NOT_A_WRITER)
  const employeeId = await employeeIdFor(actor, client)
  if (!employeeId) throw new AppError(400, NO_EMPLOYEE)
  return employeeId
}

async function personFor(employeeId: string, client: Client = prisma) {
  const employee = await client.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      fullName: true,
      designation: true,
      shiftId: true,
      joiningDate: true,
      lastWorkingDay: true,
    },
  })
  if (!employee) throw new AppError(400, NO_EMPLOYEE)
  return employee
}

/**
 * Everything the week reads, one query per source rather than one per day.
 * Only this person's own work counts (§26.6).
 */
async function loadWeek(
  employeeId: string,
  weekStart: Date,
  actor: AccessTokenPayload
): Promise<MyWeek> {
  const person = await personFor(employeeId)
  const from = saturdayBefore(weekStart)
  const to = weekEndOf(weekStart)
  // Instants are read as office dates, so the window is stretched a day at
  // each end and the composer decides which day each row lands on.
  const fromInstant = addDays(from, -1)
  const toInstant = addDays(to, 2)

  const [
    shifts,
    holidays,
    leaves,
    accounts,
    communications,
    meetings,
    deals,
    events,
    tasksDone,
    openTasks,
    report,
  ] = await Promise.all([
    prisma.shift.findMany(),
    prisma.holiday.findMany({
      where: { date: { gte: from, lte: to } },
      select: { date: true, name: true, type: true },
    }),
    prisma.leaveRequest.findMany({
      where: { employeeId, status: "APPROVED", startDate: { lte: to }, endDate: { gte: from } },
      select: { startDate: true, endDate: true, startSession: true, endSession: true },
    }),
    prisma.salesAccount.findMany({
      where: accountScopeFor(actor, employeeId),
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.salesCommunication.findMany({
      where: { employeeId, occurredAt: { gte: fromInstant, lte: toInstant } },
      select: { id: true, salesAccountId: true, channel: true, occurredAt: true, summary: true },
      orderBy: { occurredAt: "asc" },
    }),
    prisma.salesMeeting.findMany({
      where: { scheduledAt: { gte: fromInstant, lte: toInstant }, attendees: { some: { employeeId } } },
      select: { id: true, salesAccountId: true, title: true, scheduledAt: true, status: true, outcome: true },
      orderBy: { scheduledAt: "asc" },
    }),
    prisma.opportunity.findMany({
      where: { salesAccount: accountScopeFor(actor, employeeId) },
      select: {
        id: true,
        salesAccountId: true,
        serial: true,
        name: true,
        status: true,
        nextStep: true,
        softwareNeeded: true,
        lines: { select: { product: true, model: true, quantity: true }, orderBy: { order: "asc" } },
      },
    }),
    prisma.event.findMany({
      where: {
        type: { in: DEAL_CHANGE_EVENTS },
        actorUserId: actor.sub,
        createdAt: { gte: fromInstant, lte: toInstant },
      },
      select: { entityId: true, title: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.salesTask.findMany({
      where: { assignedToEmployeeId: employeeId, completedAt: { gte: fromInstant, lte: toInstant } },
      select: { id: true, salesAccountId: true, title: true, completedAt: true },
      orderBy: { completedAt: "asc" },
    }),
    prisma.salesTask.findMany({
      where: { assignedToEmployeeId: employeeId, status: "PENDING" },
      select: { id: true, salesAccountId: true, title: true, dueOn: true },
      orderBy: { dueOn: "asc" },
    }),
    prisma.weeklyReport.findUnique({
      where: { employeeId_weekStart: { employeeId, weekStart } },
      include: {
        notes: true,
        otherWork: { orderBy: { createdAt: "asc" } },
        copies: { orderBy: { submittedAt: "desc" } },
      },
    }),
  ])

  const shift = resolveShift({ shiftId: person.shiftId }, weekStart, shifts)
  const dealsById = new Map(deals.map((deal) => [deal.id, deal]))

  const view = composeWeek({
    weekStart,
    person: {
      shift,
      joiningDate: person.joiningDate,
      lastWorkingDay: person.lastWorkingDay,
    },
    holidays,
    leaves,
    accounts,
    communications,
    meetings,
    deals,
    dealChanges: events
      .map((event) => {
        const deal = dealsById.get(event.entityId)
        return deal
          ? {
              opportunityId: deal.id,
              salesAccountId: deal.salesAccountId,
              at: event.createdAt,
              title: event.title,
            }
          : null
      })
      .filter((change): change is NonNullable<typeof change> => change !== null),
    tasksDone: tasksDone
      .filter((task) => task.salesAccountId !== null && task.completedAt !== null)
      .map((task) => ({
        id: task.id,
        salesAccountId: task.salesAccountId as string,
        title: task.title,
        completedAt: task.completedAt as Date,
      })),
    openTasks: openTasks
      .filter((task) => task.salesAccountId !== null)
      .map((task) => ({
        id: task.id,
        salesAccountId: task.salesAccountId as string,
        title: task.title,
        dueOn: task.dueOn,
      })),
    notes: (report?.notes ?? []).map((note) => ({
      date: note.date,
      salesAccountId: note.salesAccountId,
      challenges: note.challenges,
      gap: note.gap,
      nextStep: note.nextStep,
      taskId: note.taskId,
    })),
    otherWork: (report?.otherWork ?? []).map((work) => ({
      id: work.id,
      date: work.date,
      text: work.text,
    })),
  })

  return {
    ...view,
    status: (report?.status as WeekStatus) ?? "NOT_STARTED",
    deadlineDay: deadlineDayOf(weekStart, shift, holidays),
    submittedLate: report?.submittedLate ?? false,
    firstSubmittedAt: report?.firstSubmittedAt ?? null,
    lastSubmittedAt: report?.lastSubmittedAt ?? null,
    copies: (report?.copies ?? []).map((copy) => ({
      id: copy.id,
      submittedAt: copy.submittedAt,
      fileName: copy.fileName,
    })),
    person: { employeeId: person.id, fullName: person.fullName, designation: person.designation },
  }
}

/** My week. Reading it writes nothing: the report row waits for a real change. */
export async function getMyWeek(query: WeekQuery, actor: AccessTokenPayload): Promise<MyWeek> {
  const employeeId = await writerFor(actor)
  return loadWeek(employeeId, weekFrom(query), actor)
}

/**
 * The week row to write into, made on the first write and never by a read.
 * A submitted week that is added to goes back to Draft, keeping its old PDFs
 * and its on-time mark (§26.4).
 */
async function openWeekFor(
  tx: Prisma.TransactionClient,
  employeeId: string,
  weekStart: Date,
  actor: AccessTokenPayload
) {
  const report = await asClient(tx).weeklyReport.upsert({
    where: { employeeId_weekStart: { employeeId, weekStart } },
    create: { employeeId, weekStart, createdBy: actor.sub },
    update: {},
  })
  if (report.status === "SUBMITTED") {
    await asClient(tx).weeklyReport.update({ where: { id: report.id }, data: { status: "DRAFT" } })
    await writeAudit(tx, {
      entity: "WEEKLY_REPORT",
      entityId: report.id,
      action: "REOPEN",
      changedBy: actor.sub,
      note: "Added to after submitting",
    })
  }
  return report
}

/** The day being written to: inside this week, and not still to come. */
function writableDate(value: string, weekStart: Date): Date {
  const date = dateFrom(value)
  if (!isInWeek(date, weekStart)) throw new AppError(400, "That day is not in this week")
  if (date.getTime() > officeToday().getTime()) throw new AppError(400, "That day has not happened yet")
  return date
}

/**
 * Challenges, Gap and — only where the account has no open deal — a typed
 * next step, for one account on one day (§26.7, §26.8).
 */
export async function saveAccountNote(
  body: SaveAccountNoteBody,
  actor: AccessTokenPayload
): Promise<void> {
  const employeeId = await writerFor(actor)
  const weekStart = weekStartOf(dateFrom(body.date))
  const date = writableDate(body.date, weekStart)

  await prisma.$transaction(async (tx) => {
    const account = await asClient(tx).salesAccount.findFirst({
      where: { AND: [{ id: body.salesAccountId }, accountScopeFor(actor, employeeId)] },
      select: { id: true, ownerEmployeeId: true },
    })
    if (!account) throw new AppError(404, ACCOUNT_NOT_YOURS)

    const report = await openWeekFor(tx, employeeId, weekStart, actor)

    let taskId: string | null = null
    if (body.makeTask && body.nextStep) {
      const task = await asClient(tx).salesTask.create({
        data: {
          salesAccountId: account.id,
          title: body.nextStep,
          dueOn: addDays(officeToday(), TASK_DUE_DAYS),
          assignedToEmployeeId: employeeId,
          createdBy: actor.sub,
        },
        select: { id: true },
      })
      taskId = task.id
    }

    const fields = {
      challenges: body.challenges,
      gap: body.gap,
      nextStep: body.nextStep,
      ...(taskId ? { taskId } : {}),
    }
    await asClient(tx).weeklyAccountNote.upsert({
      where: {
        weeklyReportId_date_salesAccountId: {
          weeklyReportId: report.id,
          date,
          salesAccountId: account.id,
        },
      },
      create: { weeklyReportId: report.id, date, salesAccountId: account.id, ...fields },
      update: fields,
    })

    await writeAudit(tx, {
      entity: "WEEKLY_REPORT",
      entityId: report.id,
      action: "UPDATE",
      changedBy: actor.sub,
      after: { date: body.date, salesAccountId: account.id, ...(taskId ? { taskId } : {}) },
      note: "Weekly report edited",
    })
  })
}

/** A line of work with no account behind it (§26.11). */
export async function addOtherWork(
  body: AddOtherWorkBody,
  actor: AccessTokenPayload
): Promise<void> {
  const employeeId = await writerFor(actor)
  const weekStart = weekStartOf(dateFrom(body.date))
  const date = writableDate(body.date, weekStart)

  await prisma.$transaction(async (tx) => {
    const report = await openWeekFor(tx, employeeId, weekStart, actor)
    await asClient(tx).weeklyOtherWork.create({
      data: { weeklyReportId: report.id, date, text: body.text },
    })
    await writeAudit(tx, {
      entity: "WEEKLY_REPORT",
      entityId: report.id,
      action: "UPDATE",
      changedBy: actor.sub,
      after: { date: body.date, otherWork: body.text },
      note: "Other work added",
    })
  })
}

export async function removeOtherWork(id: string, actor: AccessTokenPayload): Promise<void> {
  const employeeId = await writerFor(actor)
  await prisma.$transaction(async (tx) => {
    const work = await asClient(tx).weeklyOtherWork.findFirst({
      where: { id, weeklyReport: { employeeId } },
      select: { id: true, weeklyReportId: true, text: true },
    })
    if (!work) throw new AppError(404, OTHER_WORK_NOT_FOUND)
    await asClient(tx).weeklyOtherWork.delete({ where: { id: work.id } })
    await writeAudit(tx, {
      entity: "WEEKLY_REPORT",
      entityId: work.weeklyReportId,
      action: "UPDATE",
      changedBy: actor.sub,
      before: { otherWork: work.text },
      note: "Other work removed",
    })
  })
}

/**
 * All Reports: every Sales User for one week, those who have not started
 * included, because "who has not sent theirs" is the question it exists to
 * answer (§26.15).
 */
export async function listTeamWeek(
  query: WeekQuery,
  actor: AccessTokenPayload
): Promise<TeamWeekRow[]> {
  if (!isAdmin(actor)) throw new AppError(403, NOT_A_READER)
  const weekStart = weekFrom(query)

  const [people, reports] = await Promise.all([
    prisma.employee.findMany({
      where: { user: { salesRole: SalesRole.SALES_USER, isActive: true }, employmentStatus: "ACTIVE" },
      select: { id: true, fullName: true, designation: true },
      orderBy: { fullName: "asc" },
    }),
    prisma.weeklyReport.findMany({ where: { weekStart } }),
  ])

  const byEmployee = new Map(reports.map((report) => [report.employeeId, report]))
  return people.map((person) => {
    const report = byEmployee.get(person.id)
    return {
      employeeId: person.id,
      fullName: person.fullName,
      designation: person.designation,
      status: (report?.status as WeekStatus) ?? "NOT_STARTED",
      submittedLate: report?.submittedLate ?? false,
      firstSubmittedAt: report?.firstSubmittedAt ?? null,
    }
  })
}

/** One person's week, read by an admin (§26.15). Read-only: admins never write. */
export async function getEmployeeWeek(
  employeeId: string,
  query: WeekQuery,
  actor: AccessTokenPayload
): Promise<MyWeek> {
  if (!isAdmin(actor)) throw new AppError(403, NOT_A_READER)
  return loadWeek(employeeId, weekFrom(query), actor)
}

/** The PDF and the reminder job both ask about one week, the same way. */
export { loadWeek, weekFrom, writerFor }
