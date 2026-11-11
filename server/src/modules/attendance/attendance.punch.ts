/**
 * Web check-in and check-out.
 *
 * Neither endpoint takes a request body. A client-supplied timestamp is
 * spoofable (change your laptop clock), wrong the moment somebody opens the
 * app from another timezone, and unnecessary — the server already knows
 * what time it is.
 */

import prisma from "../../config/prisma"
import type { Attendance, Prisma, Shift } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { formatDateOnly } from "../../utils/dates"
import { closeRequest } from "../inbox/inbox.fanout"
import { NOT_CHECKED_OUT } from "../inbox/inbox.rules"
import { auditAttendance } from "./attendance.audit"
import { effectiveShift, resolveShift, shiftInfo } from "./attendance.grid"
import { requireEmployeeForUser } from "./attendance.service"
import {
  addMinutesToTime,
  elapsedHours,
  MAX_OPEN_SHIFT_HOURS,
  officeDateOf,
  officeTimeOf,
  subtractMinutesFromTime,
} from "./attendance.time"
import type { GridEmployee, PunchResult } from "./attendance.types"

function isUniqueViolation(err: unknown): boolean {
  return (err as Prisma.PrismaClientKnownRequestError)?.code === "P2002"
}

/**
 * Late when the office wall-clock arrival is past the shift start plus its
 * grace window. Seconds are truncated by `officeTimeOf`, so with 15 minutes'
 * grace 09:15 and 09:15:47 are both on time and 09:16 is not — a policy
 * stated in whole minutes is enforced in whole minutes.
 */
export function computeIsLate(instant: Date, shift: Shift): boolean {
  return officeTimeOf(instant) > addMinutesToTime(shift.startTime, shift.graceMinutes)
}

/**
 * Early when the departure is before the shift end less its grace window —
 * but only when the departure lands on the same office day as the record.
 * Somebody who checks out at 00:30 after working late reads as "00:30",
 * which is earlier than every threshold; without this guard, working past
 * midnight would be flagged as leaving early.
 */
export function computeIsEarlyOut(instant: Date, recordDate: Date, shift: Shift): boolean {
  if (formatDateOnly(officeDateOf(instant)) !== formatDateOnly(recordDate)) return false
  return officeTimeOf(instant) < subtractMinutesFromTime(shift.endTime, shift.graceMinutes)
}

async function shiftFor(employee: GridEmployee, date: Date): Promise<Shift> {
  return resolveShift(employee, date, await prisma.shift.findMany())
}

/**
 * The shift window a punch on this date should be judged against.
 *
 * Punch flags are frozen at capture, so the leave has to be read *before* the
 * write. The display-time lookup inside `describe` below is the same query,
 * but it runs after `isLate` has already been decided — too late to matter.
 *
 * Without this, every first-half leave flags the employee roughly four and a
 * half hours late, permanently, for arriving exactly when they were due.
 */
async function expectedWindowFor(
  employee: GridEmployee,
  date: Date,
  shift: Shift
): Promise<Shift> {
  const leave = await prisma.leaveRequest.findFirst({
    where: {
      employeeId: employee.id,
      status: "APPROVED",
      startDate: { lte: date },
      endDate: { gte: date },
    },
    select: { startDate: true, endDate: true, startSession: true, endSession: true },
  })
  if (!leave) return shift

  const key = formatDateOnly(date)
  let fraction = 1
  if (key === formatDateOnly(leave.startDate) && leave.startSession === "SECOND_HALF") {
    fraction -= 0.5
  }
  if (key === formatDateOnly(leave.endDate) && leave.endSession === "FIRST_HALF") {
    fraction -= 0.5
  }

  return effectiveShift(
    shift,
    fraction,
    fraction === 0.5 && key === formatDateOnly(leave.startDate) &&
      leave.startSession === "SECOND_HALF"
      ? "SECOND_HALF"
      : "FIRST_HALF"
  )
}

/** The derived context the punch card needs, without a second round trip. */
async function describe(row: Attendance, shift: Shift): Promise<PunchResult> {
  const [holidays, leave] = await Promise.all([
    prisma.holiday.findMany({ where: { date: row.date } }),
    prisma.leaveRequest.findFirst({
      where: {
        employeeId: row.employeeId,
        status: "APPROVED",
        startDate: { lte: row.date },
        endDate: { gte: row.date },
      },
      select: { leaveType: { select: { name: true } } },
    }),
  ])

  const offNames = holidays.filter((h) => h.type !== "WORKING_DAY").map((h) => h.name)
  const workingDayOverride = holidays.some((h) => h.type === "WORKING_DAY")
  const isWeeklyOff = shift.weeklyOffDays.includes(row.date.getUTCDay()) && !workingDayOverride

  return {
    attendanceId: row.id,
    date: formatDateOnly(row.date),
    checkIn: row.checkIn?.toISOString() ?? null,
    checkOut: row.checkOut?.toISOString() ?? null,
    workedHours: row.workedHours,
    isLate: row.isLate,
    isEarlyOut: row.isEarlyOut,
    approval: row.approval,
    // A record exists, so the day is PRESENT — a check-in beats a holiday.
    status: "PRESENT",
    isHoliday: offNames.length > 0,
    holidayName: offNames.length > 0 ? offNames.join(" · ") : null,
    isWeeklyOff,
    onApprovedLeave: leave !== null,
    leaveTypeName: leave?.leaveType.name ?? null,
    shift: shiftInfo(shift),
  }
}

export async function checkIn(userId: string): Promise<PunchResult> {
  const employee = await requireEmployeeForUser(userId)
  const now = new Date()
  const date = officeDateOf(now)
  const shift = await shiftFor(employee, date)
  const expected = await expectedWindowFor(employee, date, shift)

  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.attendance.create({
        data: {
          employeeId: employee.id,
          date,
          checkIn: now,
          isLate: computeIsLate(now, expected),
          source: "WEB",
          approval: "PENDING",
        },
      })
      await auditAttendance(tx, {
        attendanceId: created.id,
        action: "CHECK_IN",
        changedBy: userId,
        after: { checkIn: now.toISOString(), isLate: created.isLate },
      })
      return created
    })

    return describe(row, shift)
  } catch (err) {
    // The unique index on (employeeId, date) is what makes this atomic: a
    // double-tapped button hits the constraint rather than racing a
    // read-then-write and creating two rows.
    if (isUniqueViolation(err)) {
      throw new AppError(409, "You have already checked in today")
    }
    throw err
  }
}

export async function checkOut(userId: string): Promise<PunchResult> {
  const employee = await requireEmployeeForUser(userId)

  // The most recent *open* row rather than today's specifically, so somebody
  // who starts at 22:00 and finishes at 00:30 still closes the right record.
  const open = await prisma.attendance.findFirst({
    where: { employeeId: employee.id, checkIn: { not: null }, checkOut: null },
    orderBy: { date: "desc" },
  })
  if (!open?.checkIn) {
    throw new AppError(409, "You haven't checked in")
  }

  const now = new Date()
  const hours = elapsedHours(open.checkIn, now)
  if (hours > MAX_OPEN_SHIFT_HOURS) {
    // A forgotten check-out, not a long day. Closing it silently would put
    // an 18-hour shift into payroll with nobody reviewing it.
    throw new AppError(
      409,
      `Your last check-in was over ${MAX_OPEN_SHIFT_HOURS} hours ago — ask HR to correct it`
    )
  }

  // Resolved for the record's own date, not today's, so a shift window that
  // has since changed does not rewrite what this day was judged against.
  const shift = await shiftFor(employee, open.date)

  // Judged against the record's own date, and against the window a half-day
  // leave leaves behind — leaving at the midpoint on a second-half leave is
  // the expected behaviour, not an early departure.
  const expected = await expectedWindowFor(
    { ...employee, id: open.employeeId },
    open.date,
    shift
  )

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.attendance.update({
      where: { id: open.id },
      data: {
        checkOut: now,
        workedHours: hours,
        isEarlyOut: computeIsEarlyOut(now, open.date, expected),
      },
    })
    await auditAttendance(tx, {
      attendanceId: updated.id,
      action: "CHECK_OUT",
      changedBy: userId,
      before: { checkOut: null, workedHours: null },
      after: {
        checkOut: now.toISOString(),
        workedHours: hours,
        isEarlyOut: updated.isEarlyOut,
      },
    })
    // The 21:30 "not checked out" reminder is no longer true.
    await closeRequest(tx, { entity: "ATTENDANCE", entityIds: [updated.id], kinds: [NOT_CHECKED_OUT] })
    return updated
  })

  // The record stays PENDING. Closing a day is not approving it — only a
  // manager or HR who can vouch for the person being there does that.
  return describe(row, shift)
}
