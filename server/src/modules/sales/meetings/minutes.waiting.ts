/**
 * Which meetings are waiting for their minutes (revision §25.29): completed,
 * held in the last 7 office days, and nobody has started the minutes yet.
 *
 * One definition, read by the overview's row, its menu badge and the top of
 * the Meeting Minutes page, so the three can never disagree.
 */

import type { Prisma } from "../../../generated/prisma/client"
import { addDays } from "../../../utils/dates"
import { officeDateOf, officeInstantOf } from "../../attendance/attendance.time"

/** Today and the six office days before it. */
export const WAITING_DAYS = 7

/** `null` means everybody's meetings, for the team view. */
export function waitingForMinutesWhere(employeeIds: string[] | null, now: Date): Prisma.SalesMeetingWhereInput {
  const since = officeInstantOf(addDays(officeDateOf(now), -(WAITING_DAYS - 1)), "00:00")
  return {
    status: "COMPLETED",
    minutes: { is: null },
    // When it was held, not when somebody pressed Completed.
    scheduledAt: { gte: since },
    ...(employeeIds ? { attendees: { some: { side: "OURS" as const, employeeId: { in: employeeIds } } } } : {}),
  }
}
