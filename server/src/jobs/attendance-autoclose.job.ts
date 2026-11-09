/**
 * Closing the days nobody punched out of.
 *
 * A day left open blocks payroll — the row stays PENDING and preflight counts
 * it — so an unclosed Monday quietly holds up the whole month until somebody
 * notices. Before this, the only remedy was the employee spotting it or HR
 * chasing, and the one mechanism built for it (the 09:30 email nudge) posts
 * into `heroku logs`, because no SMTP is configured.
 *
 * So the day is closed at the shift's end time and **the guess is labelled**:
 * `autoCheckOutAt` is set, `AUTO_CHECK_OUT` replaces `MISSING_CHECKOUT` in the
 * approver's queue, an audit row records it, and the employee is told the next
 * morning. The record stays PENDING, so an assumed time still cannot reach a
 * payroll run without a person approving it.
 *
 * It errs low on purpose. Somebody who worked until 21:00 and forgot is
 * recorded as leaving at 18:00; with no overtime feature those hours are not
 * payable anyway, and under-crediting is the safe direction for a number
 * nobody witnessed.
 */

import prisma from "../config/prisma"
import { auditAttendance } from "../modules/attendance/attendance.audit"
import { resolveShift } from "../modules/attendance/attendance.grid"
import { emitEvent } from "../modules/event/event.emit"
import { attendanceAutoClosedEvent } from "../modules/attendance/attendance.events"
import { elapsedHours, officeInstantOf, officeToday } from "../modules/attendance/attendance.time"
import { formatDateOnly } from "../utils/dates"

export async function runAutoCloseOpenDays(): Promise<number> {
  // Today: the job runs at 22:05, just before the 22:10 attendance report, so the
  // report already counts these days as closed.
  const day = officeToday()

  const open = await prisma.attendance.findMany({
    where: { date: day, checkIn: { not: null }, checkOut: null },
    include: { employee: { select: { id: true, shiftId: true } } },
  })
  if (open.length === 0) return 0

  const shifts = await prisma.shift.findMany()
  let closed = 0

  for (const record of open) {
    if (!record.checkIn) continue

    try {
      // `resolveShift` throws when the seeded default is missing rather than
      // returning null, so this is wrapped per record: a batch that gives up
      // on the first bad row leaves everybody else's day open, and the job
      // only runs once a day.
      const shift = resolveShift({ shiftId: record.employee.shiftId }, record.date, shifts)

      const closeAt = officeInstantOf(record.date, shift.endTime)

      // Anything that would put the check-out at or before the check-in is
      // left alone: a shift ending before it started, or somebody who checked
      // in after their shift was already over. There is no honest guess for
      // those, so they stay open and keep MISSING_CHECKOUT for a human.
      if (closeAt.getTime() <= record.checkIn.getTime()) continue

      const workedHours = elapsedHours(record.checkIn, closeAt)

      await prisma.$transaction(async (tx) => {
        await tx.attendance.update({
          where: { id: record.id },
          data: {
            checkOut: closeAt,
            workedHours,
            autoCheckOutAt: new Date(),
            // Not early: they are assumed to have stayed to the end of the
            // shift, which is the whole basis of the guess.
            isEarlyOut: false,
            // Left PENDING deliberately. This is the guard that keeps an
            // assumed time out of payroll without a person seeing it.
            approval: "PENDING",
          },
        })

        await auditAttendance(tx, {
          attendanceId: record.id,
          action: "AUTO_CHECK_OUT",
          // Null actor: the system did this, and attributing it to a user
          // would put a name against a decision nobody made.
          changedBy: null,
          before: { checkOut: null },
          after: { checkOut: closeAt.toISOString(), workedHours },
        })

        await emitEvent(
          tx,
          attendanceAutoClosedEvent({
            attendanceId: record.id,
            employeeId: record.employee.id,
            date: formatDateOnly(record.date),
            closedAt: shift.endTime,
          })
        )
      })

      closed += 1
    } catch (err) {
      // Logged and skipped. The alternative is one unresolvable record
      // holding every other open day for another twenty-four hours.
      console.error(`[jobs] auto check-out failed for attendance ${record.id}`, err)
    }
  }

  return closed
}
