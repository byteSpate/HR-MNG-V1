/**
 * The date rules behind the funnel (revision §27.6, §27.9, §27.11, §27.13).
 *
 * Pure: nothing here touches Prisma, so the service, the grid composer and the
 * action items all answer "which week is this" the same way, and the answers
 * can be tested without a database.
 *
 * Every date returned is date-only at UTC midnight — the convention leave,
 * attendance and the weekly report already follow. The one exception is
 * `recentChangeSince`, which returns an instant, because it filters instants.
 */

import { addDays, MS_PER_DAY } from "../../../utils/dates"
import { weekStartOf } from "../weekly/weekly.dates"

const DAYS_PER_WEEK = 7
/** Sunday is 0, so the Saturday that closes a week is six days on from it. */
const SUNDAY_TO_SATURDAY = 6

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

/** Strips the time, leaving UTC midnight. */
function dateOnly(instant: Date): Date {
  return new Date(
    Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate())
  )
}

/**
 * The week a meeting held on `heldOn` is reviewing — its Sunday.
 *
 * A funnel meeting always looks backwards, at the week that has finished and
 * whose weekly reports are already in (§27.1). The owner's example: a week of
 * Saturday 5 to Thursday 10 September, reviewed at a meeting on Saturday the
 * 12th.
 *
 * The subtraction is the whole trick. `weekStartOf` deliberately treats a
 * Saturday as opening the week that *follows* it (§26.2), because the team's
 * sheets put Saturday's office work at the top of the week it begins. So the
 * Saturday a meeting is held on already belongs to next week, and the week
 * under review is that one less seven days.
 *
 * A meeting that slips to the Monday or Tuesday lands on the same answer,
 * since those days sit in the same week as the Saturday before them.
 */
export function weekReviewedBy(heldOn: Date): Date {
  return addDays(weekStartOf(dateOnly(heldOn)), -DAYS_PER_WEEK)
}

/**
 * The Saturday a week's review is normally held on: six days after its Sunday.
 *
 * Normally, not always — `FunnelMeeting.heldOn` records the day it actually
 * happened, which is why this is a default offered by the interface rather
 * than a rule enforced by the service.
 */
export function meetingSaturdayFor(weekStart: Date): Date {
  return addDays(dateOnly(weekStart), SUNDAY_TO_SATURDAY)
}

/**
 * When an action item handed out today is due: the next Saturday (§27.13).
 *
 * Asked on a Saturday — which is when action items are actually given out —
 * this is a week away, not the same evening. The point of the default is "by
 * the next review", and the review is the reason everyone is in the room.
 */
export function nextSaturdayFrom(from: Date): Date {
  const day = dateOnly(from)
  const ahead = SUNDAY_TO_SATURDAY - day.getUTCDay()
  return addDays(day, ahead > 0 ? ahead : DAYS_PER_WEEK)
}

/**
 * The cut-off for the grid's "changed in the last week" filter (§27.9).
 *
 * An instant rather than a date, because it is compared against
 * `lastActivityAt` and `updatedAt`, which are instants. Truncating to midnight
 * would quietly widen the window by up to a day.
 */
export function recentChangeSince(now: Date): Date {
  return new Date(now.getTime() - DAYS_PER_WEEK * MS_PER_DAY)
}

/**
 * A closing date as the grid prints it: "Oct 2026".
 *
 * Month and year only. The business does not know the day a deal will close,
 * and printing one reads as a promise somebody made (§27.6). An absent date is
 * an empty cell, as it is in the sheet — not a dash and not "Unknown", both of
 * which read as answers.
 *
 * Read off UTC, never off the host's locale: a date-only value is UTC
 * midnight, and a host behind UTC would report the previous month for every
 * first of the month.
 */
export function monthYearOf(date: Date | null | undefined): string {
  if (!date) return ""
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}
