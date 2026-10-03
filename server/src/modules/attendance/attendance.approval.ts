/**
 * Who decides on an attendance record.
 *
 * **Every record is decided by a named human.** There is no auto-approval
 * path, deliberately: a web punch proves identity and server time, nothing
 * about whether the person was actually at work. The only thing that makes
 * the record trustworthy is a manager or HR who *saw* them confirming it, so
 * removing the human removes the entire control.
 *
 * Filtering on "does this record look unusual" was tried and removed. It
 * fails in the specific way that matters: a punch faked from home produces a
 * flawless record — on time, full hours — and would sail through unseen,
 * while an honest colleague who arrived seven minutes late got scrutinised.
 * Anomaly-shaped filtering is inversely correlated with the risk it is meant
 * to catch.
 *
 * `exceptionsFor` survives that removal and is still used, but only to
 * *label* rows in the approval queue — it directs the approver's attention
 * within a list they must work through regardless. It never decides
 * anything.
 */

import prisma from "../../config/prisma"
import type { Attendance, AttendanceApproval, Shift } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { formatDateOnly } from "../../utils/dates"
import type { AccessTokenPayload } from "../auth/auth.types"
import { emitEvent } from "../event/event.emit"
import { auditAttendance } from "./attendance.audit"
import { attendanceBulkDecidedEvent, attendanceDecidedEvent } from "./attendance.events"
import { effectiveShift, resolveShift, shiftInfo } from "./attendance.grid"
import { requireEmployeeForUser } from "./attendance.service"
import { AGING_WARN_DAYS, officeToday } from "./attendance.time"
import type { ApprovalItem, ExceptionCode } from "./attendance.types"

/** An approved leave covering one record's date, reduced to a window. */
interface LeaveWindow {
  /** 1 for a whole day, 0.5 when the record's date is a half boundary. */
  fraction: number
  /** Which half the leave covers, when `fraction` is 0.5. */
  startSession: "FIRST_HALF" | "SECOND_HALF"
}

export interface EvaluatedDay {
  isLate: boolean
  isEarlyOut: boolean
  checkOut: Date | null
  workedHours: number | null
  expectedHours: number
  onApprovedLeave: boolean
  isOffDay: boolean
  regularisedAt: Date | null
  autoCheckOutAt: Date | null
  source: Attendance["source"]
}

/**
 * Why this record is worth a second look. Every record needs a human either
 * way — an empty list means "nothing stands out", not "no review needed".
 */
export function exceptionsFor(day: EvaluatedDay): ExceptionCode[] {
  const out: ExceptionCode[] = []
  if (day.isLate) out.push("LATE")
  if (day.isEarlyOut) out.push("EARLY_OUT")
  // Ordered against each other on purpose. A day the job closed has a
  // check-out, so MISSING_CHECKOUT cannot fire for it — and a shortfall is
  // meaningless when the hours were assumed rather than worked.
  if (day.autoCheckOutAt) out.push("AUTO_CHECK_OUT")
  else if (!day.checkOut) out.push("MISSING_CHECKOUT")
  else if (day.workedHours !== null && day.workedHours < day.expectedHours) out.push("SHORTFALL")
  if (day.onApprovedLeave) out.push("LEAVE_CONFLICT")
  if (day.isOffDay) out.push("WORKED_OFF_DAY")
  // The employee supplied a time nobody witnessed — worth flagging even
  // among rows that are all being reviewed anyway.
  if (day.regularisedAt) out.push("REGULARISED")
  if (day.source === "MANUAL") out.push("MANUAL_ENTRY")
  return out
}

const DECIDER_INCLUDE = {
  employee: {
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      designation: true,
      reportingManagerId: true,
      shiftId: true,
      joiningDate: true,
      employmentStatus: true,
    },
  },
} as const

/**
 * Whether this actor may decide this record.
 *
 * The rule is a single sentence, and it is also the answer to "who approves
 * the reporting manager?": **the approver is the employee's
 * reportingManagerId, and if that is null the record falls to HR.** A
 * manager is an Employee like any other, so a manager with somebody above
 * them is approved by that person, and one at the top of a line is approved
 * by HR. No role special-case — it falls out of the org chart.
 */
export async function assertCanDecide(
  actor: AccessTokenPayload,
  record: { employeeId: string; employee: { reportingManagerId: string | null } }
): Promise<void> {
  const isHr = actor.role === "HR_ADMIN" || actor.role === "SUPER_ADMIN"

  // Never decide your own record, even if the data somehow allowed it — a
  // self-referential reportingManagerId is one data-entry slip away.
  //
  // A Super Admin is the one exception: nobody sits above that role, so their
  // own record would otherwise wait for ever.
  const self = await prisma.employee.findUnique({
    where: { userId: actor.sub },
    select: { id: true },
  })
  if (self && self.id === record.employeeId && actor.role !== "SUPER_ADMIN") {
    throw new AppError(403, "You cannot approve your own attendance")
  }

  // HR and Super Admin override anyone. Without this a record is stuck the
  // moment a manager resigns, goes on leave, or is simply slow — and a stuck
  // record blocks payroll.
  if (isHr) return

  if (actor.role === "REPORTING_MANAGER" && self && record.employee.reportingManagerId === self.id) {
    return
  }

  throw new AppError(403, "You are not the approver for this record")
}

function agingDays(date: Date): number {
  return Math.max(
    0,
    Math.round((officeToday().getTime() - date.getTime()) / 86_400_000)
  )
}

async function toApprovalItem(
  record: Attendance & { employee: { id: string; fullName: string; employeeCode: string; designation: string; shiftId: string | null } },
  shifts: Shift[],
  leaveIds: Map<string, LeaveWindow>,
  holidayDates: Map<string, { isHoliday: boolean; override: boolean }>
): Promise<ApprovalItem> {
  const dateKey = formatDateOnly(record.date)
  const leave = leaveIds.get(`${record.employeeId}|${dateKey}`)
  // Narrowed for a half day, so `expectedHours` below is 4.5 rather than 9
  // and a fully-worked half stops reading as a shortfall.
  const shift = effectiveShift(
    resolveShift({ shiftId: record.employee.shiftId }, record.date, shifts),
    leave?.fraction ?? 0,
    leave?.startSession ?? "FIRST_HALF"
  )
  const holiday = holidayDates.get(dateKey)
  const isWeeklyOff = shift.weeklyOffDays.includes(record.date.getUTCDay()) && !holiday?.override

  return {
    id: record.id,
    employee: {
      id: record.employee.id,
      fullName: record.employee.fullName,
      employeeCode: record.employee.employeeCode,
      designation: record.employee.designation,
    },
    date: dateKey,
    checkIn: record.checkIn?.toISOString() ?? null,
    checkOut: record.checkOut?.toISOString() ?? null,
    workedHours: record.workedHours,
    isLate: record.isLate,
    isEarlyOut: record.isEarlyOut,
    approval: record.approval,
    regularised: record.regularisedAt !== null,
    regularisedNote: record.regularisedNote,
    // Naming *why* the record is here is what keeps the queue worked: rows
    // that all look alike get bulk-approved unread, which is the failure the
    // whole design exists to avoid.
    exceptions: exceptionsFor({
      isLate: record.isLate,
      isEarlyOut: record.isEarlyOut,
      checkOut: record.checkOut,
      workedHours: record.workedHours,
      expectedHours: shiftInfo(shift).expectedHours,
      onApprovedLeave: leave !== undefined,
      isOffDay: (holiday?.isHoliday ?? false) || isWeeklyOff,
      regularisedAt: record.regularisedAt,
      autoCheckOutAt: record.autoCheckOutAt,
      source: record.source,
    }),
    agingDays: agingDays(record.date),
    stalled: agingDays(record.date) > AGING_WARN_DAYS,
  }
}

export async function listApprovals(
  actor: AccessTokenPayload,
  status: AttendanceApproval = "PENDING",
  minAgingDays?: number
): Promise<ApprovalItem[]> {
  const where: Record<string, unknown> = { approval: status }

  if (actor.role === "REPORTING_MANAGER") {
    const self = await requireEmployeeForUser(actor.sub)
    where.employee = { reportingManagerId: self.id }
  } else if (actor.role !== "HR_ADMIN" && actor.role !== "SUPER_ADMIN") {
    throw new AppError(403, "You cannot review attendance")
  }

  const records = await prisma.attendance.findMany({
    where,
    include: DECIDER_INCLUDE,
    // Oldest first: the records ageing toward a payroll run come first.
    orderBy: { date: "asc" },
  })

  if (records.length === 0) return []

  const dates = records.map((r) => r.date)
  const [shifts, holidays, leaves] = await Promise.all([
    prisma.shift.findMany(),
    prisma.holiday.findMany({
      where: { date: { gte: min(dates), lte: max(dates) } },
    }),
    prisma.leaveRequest.findMany({
      where: {
        employeeId: { in: records.map((r) => r.employeeId) },
        status: "APPROVED",
        startDate: { lte: max(dates) },
        endDate: { gte: min(dates) },
      },
      select: {
        employeeId: true,
        startDate: true,
        endDate: true,
        startSession: true,
        endSession: true,
      },
    }),
  ])

  const holidayDates = new Map<string, { isHoliday: boolean; override: boolean }>()
  for (const h of holidays) {
    const key = formatDateOnly(h.date)
    const entry = holidayDates.get(key) ?? { isHoliday: false, override: false }
    if (h.type === "WORKING_DAY") entry.override = true
    else entry.isHoliday = true
    holidayDates.set(key, entry)
  }

  // A map rather than a set, because a half-day leave narrows the window the
  // record is judged against — 4.5 hours worked is a complete day against a
  // half-day window and a shortfall against a whole one.
  const leaveIds = new Map<string, LeaveWindow>()
  for (const record of records) {
    for (const leave of leaves) {
      if (
        leave.employeeId === record.employeeId &&
        leave.startDate <= record.date &&
        leave.endDate >= record.date
      ) {
        const key = formatDateOnly(record.date)
        let fraction = 1
        if (key === formatDateOnly(leave.startDate) && leave.startSession === "SECOND_HALF") {
          fraction -= 0.5
        }
        if (key === formatDateOnly(leave.endDate) && leave.endSession === "FIRST_HALF") {
          fraction -= 0.5
        }
        leaveIds.set(`${record.employeeId}|${key}`, {
          fraction,
          startSession:
            fraction === 0.5 &&
            key === formatDateOnly(leave.startDate) &&
            leave.startSession === "SECOND_HALF"
              ? "SECOND_HALF"
              : "FIRST_HALF",
        })
      }
    }
  }

  const items = await Promise.all(
    records.map((record) => toApprovalItem(record, shifts, leaveIds, holidayDates))
  )

  return minAgingDays === undefined
    ? items
    : items.filter((item) => item.agingDays >= minAgingDays)
}

const min = (dates: Date[]) => new Date(Math.min(...dates.map((d) => d.getTime())))
const max = (dates: Date[]) => new Date(Math.max(...dates.map((d) => d.getTime())))

/**
 * @param suppressEvent Set by `bulkDecide`, which emits **one** event for the
 *   whole batch instead. The audit row is written either way — that is the
 *   entire difference between the two logs, and it is a flag rather than a
 *   later de-duplication pass because only the caller knows whether this was
 *   one decision or the fourteenth part of one.
 */
async function decideOne(
  actor: AccessTokenPayload,
  id: string,
  decision: "APPROVE" | "REJECT",
  note?: string,
  suppressEvent = false
): Promise<void> {
  const record = await prisma.attendance.findUnique({
    where: { id },
    include: { employee: { select: { id: true, fullName: true, reportingManagerId: true } } },
  })
  if (!record) throw new AppError(404, "Attendance record not found")

  await assertCanDecide(actor, record)

  if (record.approval !== "PENDING") {
    throw new AppError(409, "This record has already been decided")
  }
  if (record.checkIn && !record.checkOut && formatDateOnly(record.date) >= formatDateOnly(officeToday())) {
    // Deciding a day that is still running is meaningless — the record is
    // not finished yet.
    throw new AppError(409, "This day is not finished yet")
  }

  await prisma.$transaction(async (tx) => {
    await tx.attendance.update({
      where: { id },
      data: {
        approval: decision === "APPROVE" ? "APPROVED" : "REJECTED",
        approvedBy: actor.sub,
        approvedAt: new Date(),
        approvalNote: note ?? null,
      },
    })
    await auditAttendance(tx, {
      attendanceId: id,
      action: decision === "APPROVE" ? "APPROVE" : "REJECT",
      changedBy: actor.sub,
      before: { approval: "PENDING" },
      after: { approval: decision === "APPROVE" ? "APPROVED" : "REJECTED" },
      note: note ?? null,
    })
    if (!suppressEvent) {
      await emitEvent(
        tx,
        attendanceDecidedEvent({
          attendanceId: id,
          decision,
          actorUserId: actor.sub,
          employee: record.employee,
          date: record.date,
          note,
        })
      )
    }
  })
}

export async function approveAttendance(actor: AccessTokenPayload, id: string, note?: string) {
  await decideOne(actor, id, "APPROVE", note)
  return { id, approval: "APPROVED" as const }
}

export async function rejectAttendance(actor: AccessTokenPayload, id: string, note: string) {
  await decideOne(actor, id, "REJECT", note)
  return { id, approval: "REJECTED" as const }
}

export interface BulkResult {
  id: string
  ok: boolean
  error?: string
}

/**
 * Bulk decision, with a per-id result rather than all-or-nothing.
 *
 * Bulk is first-class, not a convenience: a manager with 20 reports faces
 * hundreds of records a month, and one-at-a-time approval gets abandoned
 * within a week — an abandoned approval step blocks payroll while providing
 * no oversight at all. One bad id must not void the batch, or a queue of 40
 * fails wholesale on a record somebody else already handled.
 */
export async function bulkDecide(
  actor: AccessTokenPayload,
  ids: string[],
  decision: "APPROVE" | "REJECT",
  note?: string
): Promise<BulkResult[]> {
  const results: BulkResult[] = []
  for (const id of ids) {
    try {
      // Suppressed: the batch gets one event below. Each record still gets
      // its own audit row from inside `decideOne`.
      await decideOne(actor, id, decision, note, true)
      results.push({ id, ok: true })
    } catch (err) {
      results.push({
        id,
        ok: false,
        error: err instanceof AppError ? err.message : "Could not be decided",
      })
    }
  }

  // Only what actually succeeded. A batch of 14 where 2 were already decided
  // announces 12, because that is what happened.
  const decided = results.filter((r) => r.ok).map((r) => r.id)
  if (decided.length > 0) {
    const self = await prisma.employee.findUnique({
      where: { userId: actor.sub },
      select: { id: true },
    })
    await prisma.$transaction((tx) =>
      emitEvent(
        tx,
        attendanceBulkDecidedEvent({
          attendanceIds: decided,
          decision,
          actorUserId: actor.sub,
          actorEmployeeId: self?.id ?? null,
        })
      )
    )
  }

  return results
}
