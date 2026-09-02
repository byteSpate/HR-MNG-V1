import type { Tone } from "@/components/dashboard/types"
import type {
  AttendanceApproval,
  AttendanceStatus,
  ExceptionCode,
  HolidayType,
} from "@/lib/api/types"
import { parseDateString } from "@/lib/utils"

export const STATUS_TONE: Record<AttendanceStatus, Tone> = {
  PRESENT: "green",
  ABSENT: "red",
  ON_LEAVE: "yellow",
  HOLIDAY: "neutral",
  WEEKLY_OFF: "neutral",
  NOT_CHECKED_IN: "neutral",
  NOT_TRACKED: "neutral",
}

export const STATUS_LABEL: Record<AttendanceStatus, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  ON_LEAVE: "On leave",
  HOLIDAY: "Holiday",
  WEEKLY_OFF: "Weekly off",
  NOT_CHECKED_IN: "Not in yet",
  NOT_TRACKED: "Not tracked",
}

export const APPROVAL_LABEL: Record<AttendanceApproval, string> = {
  PENDING: "Awaiting review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
}

export const APPROVAL_TONE: Record<AttendanceApproval, Tone> = {
  PENDING: "yellow",
  APPROVED: "green",
  REJECTED: "red",
}

/** Plain-English reasons a record is worth a closer look, in the queue's own
 * words. Every record is reviewed; these say which ones to look at hardest. */
export const EXCEPTION_LABEL: Record<ExceptionCode, string> = {
  LATE: "Late",
  EARLY_OUT: "Left early",
  MISSING_CHECKOUT: "No check-out",
  SHORTFALL: "Short hours",
  LEAVE_CONFLICT: "On approved leave",
  WORKED_OFF_DAY: "Worked an off day",
  REGULARISED: "Employee amended",
  MANUAL_ENTRY: "Entered by HR",
  AUTO_CHECK_OUT: "Closed at shift end",
}

export const HOLIDAY_TYPE_LABEL: Record<HolidayType, string> = {
  GENERAL: "General",
  EXECUTIVE_ORDER: "Executive order",
  OPTIONAL: "Optional",
  WORKING_DAY: "Working day",
}

/** "Mon, Aug 3" */
export function formatDayLabel(date: string): string {
  return parseDateString(date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

export function formatMonthLabel(month: number, year: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  })
}

/**
 * An ISO instant rendered as an office-local clock time.
 *
 * The server already decided which business day a punch belongs to; this is
 * only for display, so the browser's own zone is acceptable here in a way it
 * never is for deciding a date.
 */
export function formatClock(iso: string | null): string {
  // Empty, not a dash. These sit in a table beside a Status column that
  // already says Absent, On leave or Not in yet, so a glyph here would be a
  // second, vaguer answer to a question already answered. An empty cell reads
  // as "nothing recorded" without competing for attention on every absent row.
  if (!iso) return ""
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })
}

/**
 * 9.08 → "9h 05m". Empty when there are no hours, for the reason above.
 *
 * Mirrored by `hours()` in `attendance.report.pdf.ts`, so the attendance
 * report reads the same on screen and printed.
 *
 * Minutes come from one rounded total rather than from the fractional part:
 * rounding the fraction on its own turns 7.999 into "7h 60m".
 */
export function formatHours(hours: number | null): string {
  if (hours === null) return ""
  const totalMinutes = Math.round(hours * 60)
  return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, "0")}m`
}

/**
 * Time owed against the shift for one day, matching the server's own rule:
 * shortfall is measured only where hours were measured, so an absence is not
 * a shortfall and neither is a missing check-out.
 *
 * An em dash rather than `0h 00m` in every case that is not a real debt. A
 * non-working day has `expectedHours: 0`, so a Friday would otherwise read
 * "short by nothing", and a column of zeroes on the days somebody worked
 * their full shift is noise that hides the days that matter.
 */
export function formatShortfall(day: {
  expectedHours: number
  workedHours: number | null
}): string {
  if (day.expectedHours <= 0 || day.workedHours === null) return "—"
  const shortfall = Math.max(0, day.expectedHours - day.workedHours)
  return shortfall > 0 ? formatHours(shortfall) : "—"
}

/** Elapsed milliseconds as a live "1h 04m 12s" counter. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`
}

/** "9:00 AM to 6:00 PM (incl. 1h break)" */
export function formatShiftSpan(
  startTime: string,
  endTime: string,
  breakMinutes: number
): string {
  const label = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number)
    const suffix = h >= 12 ? "PM" : "AM"
    const hour12 = h % 12 === 0 ? 12 : h % 12
    return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`
  }
  const breakLabel =
    breakMinutes > 0
      ? ` (incl. ${breakMinutes % 60 === 0 ? `${breakMinutes / 60}h` : `${breakMinutes}m`} break)`
      : ""
  return `${label(startTime)} to ${label(endTime)}${breakLabel}`
}

/** Minutes past the shift start plus grace, for a "Late by 14 min" note. */
export function minutesLate(checkIn: string | null, startTime: string): number | null {
  if (!checkIn) return null
  const arrival = new Date(checkIn)
  const [h, m] = startTime.split(":").map(Number)
  const expected = new Date(arrival)
  expected.setHours(h, m, 0, 0)
  const diff = Math.round((arrival.getTime() - expected.getTime()) / 60_000)
  return diff > 0 ? diff : null
}

export const currentMonth = () => {
  const now = new Date()
  return { month: now.getMonth() + 1, year: now.getFullYear() }
}

/**
 * An instant as `<input type="time">` wants it: "18:00", 24-hour, zero-padded.
 *
 * Same local-zone conversion `formatClock` does, so a prefilled field and the
 * cell it came from can never disagree. `hourCycle: "h23"` rather than
 * `hour12: false`, which renders midnight as "24:00" and is rejected by the
 * input.
 */
export function toTimeInput(iso: string | null): string | undefined {
  if (!iso) return undefined
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
}
