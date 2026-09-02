import type {
  AttendanceApproval,
  AttendanceSource,
  EmploymentStatus,
  HolidayType,
  LeaveSession,
} from "../../generated/prisma/client"

/**
 * Derived on read, never stored — hence a TS union rather than a Prisma
 * enum, since most of these values are never written to the database. Same
 * reasoning as `TeamStatus` in `leave.types.ts`.
 *
 * `NOT_CHECKED_IN` is deliberately not called PENDING: `AttendanceApproval`
 * already has a PENDING that means something entirely different (a decision
 * nobody has made, versus a punch nobody has made).
 */
export type AttendanceStatus =
  | "PRESENT"
  | "ABSENT"
  | "ON_LEAVE"
  | "HOLIDAY"
  | "WEEKLY_OFF"
  | "NOT_CHECKED_IN"
  | "NOT_TRACKED"

export interface ShiftInfo {
  id: string
  name: string
  startTime: string
  endTime: string
  breakMinutes: number
  graceMinutes: number
  weeklyOffDays: number[]
  /**
   * Elapsed hours from start to end. The lunch/break sits *inside* this
   * span, so it is never subtracted anywhere — the expectation and the
   * measurement are both elapsed time and compare directly.
   */
  expectedHours: number
}

export interface AttendanceDay {
  /** YYYY-MM-DD, office-local. */
  date: string
  status: AttendanceStatus
  /**
   * A scheduled working day: not a holiday, not a weekly off, and tracked.
   * Independent of whether anybody turned up, so a check-in on a holiday is
   * PRESENT with `isWorkingDay: false` — that day is `workedOnOffDays`, not
   * a working day the roster expected.
   */
  isWorkingDay: boolean
  /** A holiday or weekly off, regardless of whether it was worked. */
  isOffDay: boolean
  /**
   * Why it is an off day. Kept explicit rather than inferred from `detail`,
   * which also carries leave-type names — leave taken on a Friday would
   * otherwise be miscounted as a holiday.
   */
  isHoliday: boolean
  isWeeklyOff: boolean
  /** ISO instants, or null when nobody punched. */
  checkIn: string | null
  checkOut: string | null
  /** Elapsed hours. Null when the check-out is missing — never guessed. */
  workedHours: number | null
  /** The shift span for this day; 0 when it is not a working day. */
  expectedHours: number
  isLate: boolean
  isEarlyOut: boolean
  approval: AttendanceApproval | null
  source: AttendanceSource | null
  /** Leave type or holiday name, so a status can explain itself. */
  detail: string | null
  /**
   * Whether the leave covering this day is paid. Null when the day is not
   * ON_LEAVE. Carried on the day rather than re-looked-up in the summary,
   * because the grid is the only place that knows which leave applied.
   */
  leaveIsPaid: boolean | null
  /**
   * How much of this day is leave: 0, 0.5 or 1.
   *
   * Emitted **regardless of status**, unlike `leaveIsPaid` above which is
   * nulled off unless the status is ON_LEAVE. That asymmetry is the point: a
   * half-day's whole problem is that the day is PRESENT *and* partly leave,
   * and payroll has to see both.
   */
  leaveFraction: number
  /**
   * Which half `leaveFraction: 0.5` covers — the half that is *off*, already
   * normalised by the grid. Null when no leave touches the day.
   *
   * The companion to `leaveFraction`: the fraction says a day is half leave,
   * this says which half, and `effectiveShift` needs both to narrow the
   * window. Carried here so a consumer holding an `AttendanceDay` can reach
   * the same answer the grid did without re-reading the leave.
   */
  leaveStartSession: LeaveSession | null
  /**
   * What the unworked portion of a partial-leave day counts as, when nobody
   * punched. Null when there is no partial leave, or when an attendance row
   * exists — then the complement is PRESENT.
   *
   * Exists so `summariseDays` can stay pure: the past/future decision is the
   * grid's, which already makes it for the ABSENT / NOT_CHECKED_IN split.
   */
  unservedStatus: "ABSENT" | "NOT_CHECKED_IN" | null
  regularised: boolean
  /** The nightly job wrote this check-out; nobody punched it. */
  autoCheckOut: boolean
  corrected: boolean
  attendanceId: string | null
}

/** The employee fields the grid needs. Kept narrow so tests can fake it. */
export interface GridEmployee {
  id: string
  joiningDate: Date
  employmentStatus: EmploymentStatus
  shiftId: string | null
  /**
   * Authoritative exit date when set. The grid clips a leaver here rather
   * than at today — settlement's pendingSalary reads this same grid, so a
   * leaver's final month would otherwise be computed over days marked
   * NOT_TRACKED that they actually worked.
   */
  lastWorkingDay: Date | null
}

export interface EmployeeRef {
  id: string
  fullName: string
  employeeCode: string
  designation: string
}

export interface HolidayItem {
  id: string
  name: string
  date: string
  type: HolidayType
}

export interface TodayAttendance {
  /**
   * Anchors the client's ticking clock. Without it every punch card is only
   * as accurate as the laptop it runs on — a machine three minutes fast
   * shows "09:14, you're on time" while the server records 09:17 and flags
   * a late arrival that the UI said would not happen.
   */
  serverTime: string
  date: string
  status: AttendanceStatus
  checkIn: string | null
  checkOut: string | null
  workedHours: number | null
  isLate: boolean
  isEarlyOut: boolean
  approval: AttendanceApproval | null
  shift: ShiftInfo
  canCheckIn: boolean
  canCheckOut: boolean
  /** Set when today is a holiday, a weekly off, or covered by approved leave. */
  detail: string | null
  /**
   * How much of today is leave: 0, 0.5 or 1.
   *
   * A half day and a whole day are both `ON_LEAVE` carrying the same leave
   * name, so `status` and `detail` cannot separate them — and the card has to,
   * because one says "you are expected for the other half" and the other says
   * "your leave stands whether or not you check in". Paired with `shift`,
   * which is already narrowed to the half actually worked.
   */
  leaveFraction: number
}

/**
 * A punch, plus the derived context the card needs to explain itself —
 * "you're working a holiday", "you have approved leave today" — without a
 * second round trip.
 */
export interface PunchResult {
  attendanceId: string
  date: string
  checkIn: string | null
  checkOut: string | null
  workedHours: number | null
  isLate: boolean
  isEarlyOut: boolean
  approval: AttendanceApproval
  status: AttendanceStatus
  isHoliday: boolean
  holidayName: string | null
  isWeeklyOff: boolean
  onApprovedLeave: boolean
  leaveTypeName: string | null
  shift: ShiftInfo
}

/** Why a record is worth a closer look. Empty means nothing stands out — the
 * approver still has to decide it. */
export type ExceptionCode =
  | "LATE"
  | "EARLY_OUT"
  | "MISSING_CHECKOUT"
  | "SHORTFALL"
  | "LEAVE_CONFLICT"
  | "WORKED_OFF_DAY"
  | "REGULARISED"
  | "MANUAL_ENTRY"
  /**
   * The nightly job closed the day at the shift's end time because nobody
   * punched out.
   *
   * Load-bearing rather than decorative. `MISSING_CHECKOUT` is computed as
   * `!checkOut`, so filling that field in silences it — and the guessed time
   * would reach the approver looking exactly like a punched one. This is what
   * stops the auto-close from hiding the very thing it is closing.
   */
  | "AUTO_CHECK_OUT"

export interface ApprovalItem {
  id: string
  employee: EmployeeRef
  date: string
  checkIn: string | null
  checkOut: string | null
  workedHours: number | null
  isLate: boolean
  isEarlyOut: boolean
  approval: AttendanceApproval
  regularised: boolean
  regularisedNote: string | null
  /** Named so the queue explains itself; undifferentiated rows get bulk-approved unread. */
  exceptions: ExceptionCode[]
  agingDays: number
  stalled: boolean
}

export interface DailySummaryRow {
  employee: EmployeeRef
  status: AttendanceStatus
  checkIn: string | null
  checkOut: string | null
  workedHours: number | null
  isLate: boolean
  isEarlyOut: boolean
  approval: AttendanceApproval | null
  detail: string | null
}

export interface DailySummary {
  date: string
  totals: {
    present: number
    late: number
    absent: number
    onLeave: number
    holiday: number
    weeklyOff: number
    notCheckedIn: number
    pendingApproval: number
  }
  rows: DailySummaryRow[]
  /**
   * Checking in while on approved leave is allowed, not blocked — a 409
   * would leave someone who genuinely came in unable to record real work.
   * It surfaces here instead, for a human to resolve.
   */
  conflicts: Array<{
    employeeId: string
    fullName: string
    reason: "CHECKED_IN_WHILE_ON_LEAVE"
  }>
}

export interface WeeklySummaryDay {
  date: string
  /**
   * Why the day is what it is. A zero `present` on a HOLIDAY is not the same
   * fact as a zero on a WORKING day, and a chart that cannot tell them apart
   * invites the wrong question at the wrong standup.
   *
   * Resolved across the roster, not per employee: a day is WORKING if it was
   * a scheduled working day for anyone on it, since shifts can differ. Only
   * when it was nobody's working day does it report why — HOLIDAY ahead of
   * WEEKLY_OFF, matching the grid's own precedence.
   */
  kind: "WORKING" | "WEEKLY_OFF" | "HOLIDAY"
  present: number
  late: number
  absent: number
  onLeave: number
  notCheckedIn: number
}

export interface WeeklySummary {
  from: string
  to: string
  /**
   * Roster size the counts are out of, so the client renders "13 of 16"
   * without a second call.
   */
  headcount: number
  days: WeeklySummaryDay[]
}

/**
 * The payroll contract. Payroll imports `getMonthlySummary` rather than
 * re-deriving from `Attendance` rows: status is computed, so that function
 * *is* the source of truth, and a second implementation of the day grid
 * would drift with the untested one living in payroll.
 */
export interface MonthlyAttendanceSummary {
  employee: EmployeeRef
  month: number
  year: number
  /** Scheduled working days: range minus weekly offs and holidays, plus
   *  WORKING_DAY overrides, clipped to employment and go-live. */
  workingDays: number
  present: number
  absent: number
  /** The total, so the four-term working-day identity still holds. */
  onLeave: number
  /**
   * `onLeave` split by whether the leave type is paid. Payroll's deduction
   * rule needs exactly this distinction — `lopDays = absent + onUnpaidLeave`
   * — and charging paid leave would be a straightforward underpayment.
   */
  onPaidLeave: number
  /** The only leave that costs the employee money. */
  onUnpaidLeave: number
  /** Working days that have not happened yet (today or later). */
  notCheckedIn: number
  late: number
  earlyOut: number
  holidays: number
  weeklyOffs: number
  /** Check-ins on a holiday or weekly off. Outside the working-day identity. */
  workedOnOffDays: number
  workedHours: number
  /**
   * `workedHours` restricted to scheduled working days, so hours worked on a
   * holiday or weekly off are excluded.
   *
   * Exists because `workedHours` and `present` are drawn from different sets
   * of days and dividing one by the other is not a rate. Paired with
   * `workingDaysFullyRecorded` below — use the two together or neither.
   */
  workedHoursOnWorkingDays: number
  /**
   * Working days that were attended and completely measured: PRESENT, with a
   * record, and with both a check-in and a check-out.
   *
   * A missing check-out is excluded on purpose. Its hours are deliberately
   * never guessed, so counting the day would put a whole day into a
   * denominator whose numerator got nothing.
   *
   * A whole number, unlike `present`, which is a share and can be 0.5 — so a
   * half-day leave counts here as one attended day.
   */
  workingDaysFullyRecorded: number
  expectedHours: number
  /**
   * `expectedHours` counted only up to and including today, so a month still
   * running compares like with like.
   *
   * `expectedHours` covers every working day in the calendar month, days that
   * have not happened included, while `shortfallHours` can only ever reach
   * days somebody attended. Showing those two together pairs a whole-month
   * target with time owed on a handful of days.
   *
   * Separate rather than a change to `expectedHours`, which payroll, the
   * report and the PDF all consume. For a finished month the two are equal,
   * so a caller renders the same thing either way with no branch.
   */
  expectedHoursToDate: number
  shortfallHours: number
  missingCheckOut: number
  /** Payroll gate: a month with any of these must not be run. */
  pendingApproval: number
  /** Signed off by a named manager or HR — the only way a record is approved. */
  approved: number
  regularised: number
  rejected: number
}
