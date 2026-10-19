/**
 * Generic date-only arithmetic, shared across modules.
 *
 * A "date-only" value is a calendar date pinned to UTC midnight, never an
 * instant — so two dates compare exactly, and a date the user picked never
 * shifts by one because the server's locale differs from theirs.
 *
 * Only the arithmetic lives here. Policy stays with the module that owns it:
 * leave's weekly-off day and backdating window are in `leave.dates.ts`, and
 * attendance's office timezone is in `attendance.time.ts`.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export const MS_PER_DAY = 86_400_000

export function parseDateOnly(value: string): Date {
  if (!DATE_ONLY.test(value)) {
    throw new Error(`Expected a YYYY-MM-DD date, received "${value}"`)
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  // The round-trip check catches dates that parse but roll over, such as
  // "2026-02-30" becoming 2 March.
  if (Number.isNaN(date.getTime()) || formatDateOnly(date) !== value) {
    throw new Error(`"${value}" is not a valid calendar date`)
  }
  return date
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY)
}

const SHORT_MONTHS = [
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

/**
 * "Aug 12", for strings frozen into an event at emit.
 *
 * Read in UTC like every other date-only value here, so the day never shifts
 * by one against the date the user actually picked. Not locale-aware: these
 * strings are stored, not rendered, and a stored string that depends on the
 * server's locale would be a different sentence after a redeploy.
 */
export function formatShortDate(date: Date): string {
  return `${SHORT_MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`
}

const LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/** "3 October 2026", read in UTC so the day never shifts. For text people read, like History. */
export function longDate(date: Date): string {
  return `${date.getUTCDate()} ${LONG_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}
