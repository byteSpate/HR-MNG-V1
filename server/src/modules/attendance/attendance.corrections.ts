/**
 * The three ways a record gets changed after the fact.
 *
 * `regularise` is the employee amending their own day; `correct` and
 * `createManual` are HR acting with authority. They share almost all their
 * machinery and are deliberately kept separate anyway: the employee is
 * *requesting* a change to their own record and cannot grant it, while HR is
 * *making* one. Same write, opposite trust level.
 */

import prisma from "../../config/prisma"
import type { Attendance, Prisma, Shift } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { formatDateOnly, parseDateOnly } from "../../utils/dates"
import type { AccessTokenPayload } from "../auth/auth.types"
import { emitEvent } from "../event/event.emit"
import { auditAttendance } from "./attendance.audit"
import {
  attendanceCorrectedEvent,
  attendanceRegularisedEvent,
} from "./attendance.events"
import { resolveShift } from "./attendance.grid"
import { computeIsEarlyOut, computeIsLate } from "./attendance.punch"
import { requireEmployeeForUser } from "./attendance.service"
import {
  elapsedHours,
  MAX_REGULARISE_DAYS,
  officeInstantOf,
  officeToday,
} from "./attendance.time"
import type { CorrectionBody, ManualAttendanceBody, RegulariseBody } from "./attendance.validators"

async function shiftForDate(
  employee: { id: string; shiftId: string | null },
  date: Date
): Promise<Shift> {
  const shifts = await prisma.shift.findMany()
  return resolveShift({ shiftId: employee.shiftId }, date, shifts)
}

interface AppliedTimes {
  checkIn: Date | null
  checkOut: Date | null
  workedHours: number | null
  isLate: boolean
  isEarlyOut: boolean
}

/** Recomputes the derived fields against the shift in force *on that date*. */
function applyTimes(
  existing: Pick<Attendance, "date" | "checkIn" | "checkOut">,
  shift: Shift,
  times: { checkIn?: string; checkOut?: string }
): AppliedTimes {
  const checkIn = times.checkIn
    ? officeInstantOf(existing.date, times.checkIn)
    : existing.checkIn
  const checkOut = times.checkOut
    ? officeInstantOf(existing.date, times.checkOut)
    : existing.checkOut

  if (checkIn && checkOut && checkOut <= checkIn) {
    throw new AppError(400, "The check-out time is not after the check-in time")
  }

  return {
    checkIn,
    checkOut,
    workedHours: checkIn && checkOut ? elapsedHours(checkIn, checkOut) : null,
    isLate: checkIn ? computeIsLate(checkIn, shift) : false,
    isEarlyOut: checkIn && checkOut ? computeIsEarlyOut(checkOut, existing.date, shift) : false,
  }
}

/**
 * Only the fields a time change touches. `before`/`after` carry the changed
 * fields rather than whole snapshots — enough to reconstruct the sequence
 * without duplicating the record on every write.
 */
const timeSnapshot = (r: Pick<Attendance, "checkIn" | "checkOut" | "workedHours">) => ({
  checkIn: r.checkIn?.toISOString() ?? null,
  checkOut: r.checkOut?.toISOString() ?? null,
  workedHours: r.workedHours,
})

/**
 * The employee fixing their own day — overwhelmingly a forgotten check-out,
 * which is the single most common failure of any web attendance system.
 *
 * Routing every one of those through HR buries them by the second week, and
 * the person who actually knows when they left is the employee. The trade is
 * that they supply a time nobody witnessed, which is why the record is forced
 * back to PENDING, flagged REGULARISED to the approver, and why the audit row
 * records who typed it.
 */
export async function regulariseAttendance(
  userId: string,
  id: string,
  body: RegulariseBody
): Promise<{ id: string; approval: "PENDING" }> {
  const employee = await requireEmployeeForUser(userId)
  const record = await prisma.attendance.findUnique({ where: { id } })
  if (!record) throw new AppError(404, "Attendance record not found")

  if (record.employeeId !== employee.id) {
    throw new AppError(403, "You can only amend your own attendance")
  }
  if (record.approval === "APPROVED") {
    throw new AppError(409, "This record is already approved. Ask HR to correct it.")
  }

  const ageDays = Math.round((officeToday().getTime() - record.date.getTime()) / 86_400_000)
  if (ageDays > MAX_REGULARISE_DAYS) {
    throw new AppError(
      409,
      `You can only amend the last ${MAX_REGULARISE_DAYS} days — ask HR to correct this one`
    )
  }

  const shift = await shiftForDate(employee, record.date)
  const applied = applyTimes(record, shift, body)

  await prisma.$transaction(async (tx) => {
    await tx.attendance.update({
      where: { id },
      data: {
        ...applied,
        regularisedAt: new Date(),
        regularisedNote: body.note,
        // Back to PENDING regardless of what it was: the numbers changed and
        // whoever approves this employee has not seen the new ones.
        approval: "PENDING",
        approvedBy: null,
        approvedAt: null,
      },
    })
    await auditAttendance(tx, {
      attendanceId: id,
      action: "REGULARISE",
      changedBy: userId,
      before: timeSnapshot(record),
      after: timeSnapshot(applied),
      note: body.note,
    })
    await emitEvent(
      tx,
      attendanceRegularisedEvent({
        attendanceId: id,
        actorUserId: userId,
        employee,
        date: record.date,
        note: body.note,
      })
    )
  })

  return { id, approval: "PENDING" }
}

export async function correctAttendance(
  actor: AccessTokenPayload,
  id: string,
  body: CorrectionBody
): Promise<{ id: string; approval: "APPROVED" }> {
  const record = await prisma.attendance.findUnique({
    where: { id },
    include: { employee: { select: { id: true, fullName: true, shiftId: true } } },
  })
  if (!record) throw new AppError(404, "Attendance record not found")

  const shift = await shiftForDate(record.employee, record.date)
  const applied = applyTimes(record, shift, body)

  await prisma.$transaction(async (tx) => {
    await tx.attendance.update({
      where: { id },
      data: {
        ...applied,
        correctedBy: actor.sub,
        correctedAt: new Date(),
        correctionNote: body.note,
        // HR outranks the manager in this chain, so a corrected record is
        // settled rather than parked in a queue whose owner has already
        // been overruled.
        approval: "APPROVED",
        approvedBy: actor.sub,
        approvedAt: new Date(),
      },
    })
    await auditAttendance(tx, {
      attendanceId: id,
      action: "CORRECT",
      changedBy: actor.sub,
      before: timeSnapshot(record),
      after: timeSnapshot(applied),
      note: body.note,
    })
    await emitEvent(
      tx,
      attendanceCorrectedEvent({
        attendanceId: id,
        actorUserId: actor.sub,
        employee: record.employee,
        date: record.date,
        note: body.note,
      })
    )
  })

  return { id, approval: "APPROVED" }
}

function isUniqueViolation(err: unknown): boolean {
  return (err as Prisma.PrismaClientKnownRequestError)?.code === "P2002"
}

export async function createManualAttendance(
  actor: AccessTokenPayload,
  body: ManualAttendanceBody
): Promise<{ id: string }> {
  const employee = await prisma.employee.findUnique({
    where: { id: body.employeeId },
    select: { id: true, fullName: true, shiftId: true },
  })
  if (!employee) throw new AppError(404, "Employee not found")

  const date = parseDateOnly(body.date)
  const shift = await shiftForDate(employee, date)
  const applied = applyTimes({ date, checkIn: null, checkOut: null }, shift, body)

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.attendance.create({
        data: {
          employeeId: employee.id,
          date,
          ...applied,
          // HR entering the record is itself the human decision, so it is
          // approved here rather than queued back to whoever created it.
          source: "MANUAL",
          approval: "APPROVED",
          approvedBy: actor.sub,
          approvedAt: new Date(),
          correctedBy: actor.sub,
          correctedAt: new Date(),
          correctionNote: body.note,
        },
      })
      await auditAttendance(tx, {
        attendanceId: row.id,
        action: "CORRECT",
        changedBy: actor.sub,
        after: timeSnapshot(applied),
        note: body.note,
      })
      // Beyond the two corrections the plan named, and deliberately: an
      // employee who is never told HR manufactured an attendance record for
      // them is exactly the employee who should be able to query it.
      await emitEvent(
        tx,
        attendanceCorrectedEvent({
          attendanceId: row.id,
          actorUserId: actor.sub,
          employee,
          date,
          note: body.note,
        })
      )
      return row
    })
    return { id: created.id }
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(
        409,
        `${formatDateOnly(date)} already has a record for this employee — edit it instead`
      )
    }
    throw err
  }
}

export async function getAuditTrail(actor: AccessTokenPayload, id: string) {
  const record = await prisma.attendance.findUnique({ where: { id }, select: { id: true } })
  if (!record) throw new AppError(404, "Attendance record not found")
  if (actor.role !== "HR_ADMIN" && actor.role !== "SUPER_ADMIN") {
    throw new AppError(403, "Only HR can read the change history")
  }
  const audits = await prisma.attendanceAudit.findMany({
    where: { attendanceId: id },
    orderBy: { changedAt: "asc" },
  })
  return audits.map((a) => ({
    id: a.id,
    action: a.action,
    changedBy: a.changedBy,
    changedAt: a.changedAt.toISOString(),
    before: a.before,
    after: a.after,
    note: a.note,
  }))
}
