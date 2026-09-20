/**
 * Calendar quarters, in office-local time.
 *
 * Sales counts January to March as Q1 (decision C2). The ledger's financial
 * year starts on 1 July and does not. That mismatch is deliberate, and it is
 * why `SalesTarget.calendarYear` is named the way it is — anything putting a
 * sales figure beside an accounting one has to say which year it means.
 *
 * Every boundary here is **local midnight**, converted to the instant that
 * midnight actually happened. Bucketing on the UTC date instead would move a
 * deal closed at 23:00 in Dhaka on 31 March into Q2, quietly rewriting a past
 * quarter's achievement. The conversion is not reimplemented: `officeDateOf`
 * documents itself as the only sanctioned way to decide which local day an
 * instant belongs to, and `officeInstantOf` measures the offset from the date
 * itself rather than hard-coding it, so both stay correct if APP_TIMEZONE is
 * ever pointed somewhere that observes daylight saving.
 */

import { parseDateOnly } from "../../../utils/dates"
import { officeDateOf, officeInstantOf } from "../../attendance/attendance.time"

export interface QuarterRange {
  /** Inclusive. The instant local midnight began on the quarter's first day. */
  start: Date
  /** Exclusive, and identical to the next quarter's `start` — no gap, no overlap. */
  end: Date
}

function localMidnightOnFirst(year: number, month: number): Date {
  return officeInstantOf(parseDateOnly(`${year}-${String(month).padStart(2, "0")}-01`), "00:00")
}

/**
 * The half-open instant range `[start, end)` of one calendar quarter.
 *
 * Half-open rather than inclusive at both ends, so a deal closed in the last
 * second of a quarter belongs to exactly one of them. An inclusive end would
 * double-count anything landing precisely on midnight.
 */
export function quarterRange(calendarYear: number, quarter: number): QuarterRange {
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
    throw new Error(`Quarter must be 1, 2, 3 or 4, received ${quarter}`)
  }
  const startMonth = (quarter - 1) * 3 + 1
  const endMonth = startMonth + 3
  return {
    start: localMidnightOnFirst(calendarYear, startMonth),
    // Q4 ends on 1 January of the following year, which is why this wraps
    // rather than clamping at December.
    end:
      endMonth > 12
        ? localMidnightOnFirst(calendarYear + 1, endMonth - 12)
        : localMidnightOnFirst(calendarYear, endMonth),
  }
}

/** Which quarter an instant falls in, read as an office-local date. */
export function quarterOf(instant: Date): number {
  return Math.floor(officeDateOf(instant).getUTCMonth() / 3) + 1
}

/**
 * The quarter an instant sits in, with the year it belongs to *locally*.
 *
 * The two can disagree: 18:00 UTC on 31 December is already 1 January here,
 * so the year comes from the local date and never from the instant.
 */
export function currentQuarter(now: Date = new Date()): {
  calendarYear: number
  quarter: number
} {
  const local = officeDateOf(now)
  return {
    calendarYear: local.getUTCFullYear(),
    quarter: Math.floor(local.getUTCMonth() / 3) + 1,
  }
}
