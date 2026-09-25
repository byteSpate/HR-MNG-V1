// `export *` at the foot of this file re-exports payroll-types but does not
// bring its names into local scope, so Employee's structure ref imports it.
import type { Currency } from "./payroll-types"

// Hand-mirrored from server/src/generated/prisma's Role enum. No shared
// types package (client and server are separate projects) — if the
// server's Role enum changes, update this by hand.
export type Role = "SUPER_ADMIN" | "HR_ADMIN" | "FINANCE_OFFICER" | "REPORTING_MANAGER" | "EMPLOYEE"
export interface PostingRule { id: string; event: string; key: string; accountId: string; note: string | null; account: { code: string; name: string } }
export interface UnresolvedKey { event: string; key: string }

/** The second permission axis, held alongside `role` rather than instead of
    it. Null means no Sales Hub access at all. */
export type SalesRole = "SALES_ADMIN" | "SALES_USER"

export interface SetSalesRoleResult {
  salesRole: SalesRole | null
  /** Present when revoking or narrowing access leaves owned accounts without
      an owner who can work them. */
  orphanedAccounts?: number
}

export interface PublicUser {
  id: string
  email: string
  role: Role
  isActive: boolean
  mustChangePassword: boolean
  employeeCode?: string
  salesRole: SalesRole | null
}

export type SalesAccountStatus = "ACTIVE" | "INACTIVE" | "DO_NOT_CONTACT"

export interface SalesAccountSummary {
  id: string
  name: string
  industry: string | null
  website: string | null
  address: string | null
  status: SalesAccountStatus
  /** Why the account is Inactive or Do Not Contact. The server requires one
      whenever the status leaves ACTIVE and clears it on the way back, so a
      status badge is never shown without the sentence explaining it. */
  statusReason: string | null
  ownerEmployeeId: string
  ownerName: string
  assigneeCount: number
  /** Named, not just counted — "All Accounts" shows who, not just how many. */
  assignees: { id: string; fullName: string }[]
  /** Owner, assignee, or admin — computed per viewer. Gates write controls
      without re-deriving the server's rule client-side. */
  canManage: boolean
  /** Whether the *owner* can still work this account — role, employment and
      a working login. False after their access is revoked or their exit is
      recorded, since neither operation reassigns the account. */
  ownerActive: boolean
  /** Narrower than `canManage`: a communication's author is a required
      column, so an account with no Employee row behind it (Super Admin, HR
      Admin) is refused by the server however senior. Gates "Log a call"
      specifically, so the button is never offered where it cannot work. */
  canLogActivity: boolean
  createdAt: string
}

/** Who the "New Sales Account" owner/collaborator pickers may offer —
    employees who already hold a salesRole, and only those. */
export interface SalesEligibleEmployee {
  id: string
  fullName: string
  designation: string
}

export interface CreateSalesAccountBody {
  name: string
  ownerEmployeeId: string
  industry?: string
  website?: string
  address?: string
  assigneeIds?: string[]
}

export type SalesContactStatus = "UNVERIFIED" | "VERIFIED" | "UNREACHABLE" | "INVALID"

export interface SalesContactSummary {
  id: string
  salesAccountId: string
  name: string
  designation: string | null
  phone: string | null
  email: string | null
  isPrimary: boolean
  status: SalesContactStatus
  /** ISO, or null when nobody has reached this person yet. */
  verifiedAt: string | null
  note: string | null
  createdAt: string
}

export interface CreateSalesContactBody {
  name: string
  designation?: string
  phone?: string
  email?: string
  note?: string
}

export interface SetContactStatusBody {
  status: SalesContactStatus
  note?: string
}

export type SalesChannel = "CALL" | "EMAIL" | "WHATSAPP" | "OTHER"

export interface SalesCommunicationSummary {
  id: string
  salesAccountId: string
  contactId: string | null
  channel: SalesChannel
  occurredAt: string
  summary: string
  detail: string | null
  employeeId: string
  createdAt: string
}

export interface LogCommunicationBody {
  channel: SalesChannel
  /** ISO 8601. The server refuses one in the future. */
  occurredAt: string
  summary: string
  detail?: string
  contactId?: string
}

/** One line of an account's story, rendered rather than raw — the channel is
    already a label and the author already a name. */
export interface TimelineItem {
  id: string
  kind: "communication" | "event" | "comment" | "meeting" | "task"
  at: string
  title: string
  meta: string | null
  by: string | null
  /** The long-form note on a communication. Null for an event. */
  detail: string | null
}

/** One changed field, already rendered server-side: `label` is a phrase
    rather than a column name, and ids have been resolved to people's names. */
export interface HistoryChange {
  field: string
  label: string
  /** Null when the field was set for the first time — show one value, not an arrow. */
  before: string | null
  after: string
}

/** One audit row from the account's own trail, or one of its contacts' —
    field-by-field, distinct from the Timeline's "what happened". */
export interface AccountHistoryEntry {
  id: string
  entity: "SALES_ACCOUNT" | "SALES_CONTACT"
  entityId: string
  action: string
  changedAt: string
  /** Already a name, not a user id. Null when nothing recorded who did it. */
  changedByName: string | null
  changes: HistoryChange[]
  note: string | null
}

/** One page of history. Wrapped so a capped read can admit it is capped. */
export interface AccountHistory {
  items: AccountHistoryEntry[]
  truncated: boolean
  limit: number
}

export interface OpportunityHistoryEntry extends Omit<AccountHistoryEntry, "entity"> {
  entity: "OPPORTUNITY" | "OPPORTUNITY_LINE"
}

export interface OpportunityHistory {
  items: OpportunityHistoryEntry[]
  truncated: boolean
  limit: number
}

export interface LoginResponse {
  accessToken: string
  user: PublicUser
}

export type EmploymentType = "FULL_TIME" | "PART_TIME" | "CONTRACT" | "INTERN"
export type EmploymentStatus = "ACTIVE" | "ON_LEAVE" | "RESIGNED" | "TERMINATED"

export interface Department {
  id: string
  name: string
  costNature: "DIRECT" | "ADMINISTRATIVE"
}

export interface Employee {
  id: string
  employeeCode: string
  fullName: string
  email: string
  designation: string
  department: Department
  employmentType: EmploymentType
  employmentStatus: EmploymentStatus
  joiningDate: string
  /** `null` is preflight blocker 3 waiting to happen — the directory says so. */
  salaryStructure: { id: string; name: string; currency: Currency } | null
}

export interface CreateStaffAccountInput {
  fullName: string
  email: string
  role: "EMPLOYEE" | "REPORTING_MANAGER"
  designation: string
  departmentId: string
  employmentType: EmploymentType
  joiningDate: string
  // Both optional: the server already accepted `reportingManagerId` (see
  // employee.validators.ts's createStaffAccountSchema) before this task —
  // only `shiftId` is new. Mirrored together since the create form sends both.
  reportingManagerId?: string
  shiftId?: string
}

export interface CreateStaffAccountResult {
  employeeCode: string
  temporaryPassword: string
  fullName: string
  email: string
}

export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"
export type TeamStatus = "ACTIVE" | "ON_LEAVE" | "LEFT"

export type LeaveAccrualBasis = "PRO_RATED" | "PER_EVENT" | "EARNED" | "NONE"

/** Which half of a working day. Mirrors the server's LeaveSession enum. */
export type LeaveSession = "FIRST_HALF" | "SECOND_HALF"

/**
 * The shift window a half day is measured against, for one date.
 *
 * Per date rather than per employee: a dated shift override (Ramadan hours)
 * moves the midpoint, so a window cached at login would be wrong for a leave
 * filed into that window.
 */
export interface HalfDayWindow {
  startTime: string
  midpoint: string
  endTime: string
}

export interface LeaveType {
  id: string
  /** Stable machine key (CASUAL, SICK, EARNED, MATERNITY, LWP, …). */
  code: string
  name: string
  isPaid: boolean
  annualQuota: number
  carryForwardPct: number
  maxConsecutive: number | null
  allowsBackdating: boolean
  eligibleFor: EmploymentType[]
  /** Granted by the Bangladesh Labour Act rather than by company policy. */
  statutory: boolean
  /**
   * §117(3): holidays inside an earned-leave period are part of the leave, so
   * the day-count preview must charge calendar days for these types and
   * working days for every other one.
   */
  countsHolidays: boolean
  accrualBasis: LeaveAccrualBasis
  minServiceMonths: number
  maxAccrual: number | null
  /** Whether a request against this type may be a half day. */
  allowsHalfDay: boolean
}

export interface DecidedBy {
  id: string
  email: string
  fullName: string | null
}

export interface LeaveRequestItem {
  id: string
  employee: { id: string; fullName: string; employeeCode: string }
  leaveType: { id: string; code: string; name: string; isPaid: boolean }
  startDate: string
  endDate: string
  startSession: LeaveSession
  endSession: LeaveSession
  days: number
  reason: string | null
  status: LeaveStatus
  decidedBy: DecidedBy | null
  decidedAt: string | null
  decisionNote: string | null
  createdAt: string
}

/** Where an earned-leave entitlement came from. Only on EARNED types. */
export interface AccrualDetail {
  daysWorked: number
  perDaysWorked: number
  windowStart: string
  windowEnd: string
  /** Days in the window that predate attendance tracking, so are unknown. */
  untrackedDays: number
  eligible: boolean
  minServiceMonths: number
}

export interface LeaveBalanceItem {
  leaveTypeId: string
  code: string
  name: string
  isPaid: boolean
  annualQuota: number
  entitlement: number
  used: number
  pending: number
  balance: number
  accrual: AccrualDetail | null
}

export interface TeamMemberStatus {
  id: string
  fullName: string
  employeeCode: string
  designation: string
  status: TeamStatus
  currentLeave: { leaveTypeName: string; startDate: string; endDate: string } | null
}

export interface ApplyLeaveInput {
  leaveTypeId: string
  startDate: string
  endDate: string
  /** Defaulted server-side, so these are only optional to callers. */
  startSession?: LeaveSession
  endSession?: LeaveSession
  reason?: string
}

// ── ATTENDANCE ────────────────────────────────
// Hand-mirrored from server/src/modules/attendance/attendance.types.ts.
// No shared package between client and server by design — keep in sync.

export type AttendanceStatus =
  | "PRESENT"
  | "ABSENT"
  | "ON_LEAVE"
  | "HOLIDAY"
  | "WEEKLY_OFF"
  | "NOT_CHECKED_IN"
  | "NOT_TRACKED"

export type AttendanceApproval = "PENDING" | "APPROVED" | "REJECTED"

export type AttendanceSource = "WEB" | "MANUAL" | "RFID" | "FACE" | "FINGERPRINT"

export type HolidayType = "GENERAL" | "EXECUTIVE_ORDER" | "OPTIONAL" | "WORKING_DAY"

export type ExceptionCode =
  | "LATE"
  | "EARLY_OUT"
  | "MISSING_CHECKOUT"
  | "SHORTFALL"
  | "LEAVE_CONFLICT"
  | "WORKED_OFF_DAY"
  | "REGULARISED"
  | "MANUAL_ENTRY"
  | "AUTO_CHECK_OUT"

export interface ShiftInfo {
  id: string
  name: string
  startTime: string
  endTime: string
  breakMinutes: number
  graceMinutes: number
  weeklyOffDays: number[]
  expectedHours: number
}

export interface AttendanceDay {
  date: string
  status: AttendanceStatus
  isWorkingDay: boolean
  isOffDay: boolean
  isHoliday: boolean
  isWeeklyOff: boolean
  checkIn: string | null
  checkOut: string | null
  workedHours: number | null
  expectedHours: number
  isLate: boolean
  isEarlyOut: boolean
  approval: AttendanceApproval | null
  source: AttendanceSource | null
  detail: string | null
  /**
   * How much of this day is leave: 0, 0.5 or 1. Emitted regardless of
   * status — a half-day is PRESENT *and* partly leave at the same time.
   */
  leaveFraction: number
  /**
   * Which half a `leaveFraction` of 0.5 covers — the half that is off. Null
   * when no leave touches the day.
   */
  leaveStartSession: "FIRST_HALF" | "SECOND_HALF" | null
  /**
   * What the unworked portion of a partial-leave day counts as, when nobody
   * punched. Null when there is no partial leave or an attendance row exists.
   */
  unservedStatus: "ABSENT" | "NOT_CHECKED_IN" | null
  regularised: boolean
  /** The nightly job wrote this check-out; nobody punched it. */
  autoCheckOut: boolean
  corrected: boolean
  attendanceId: string | null
}

export interface TodayAttendance {
  /** Anchors the client clock; never trust the browser's own. */
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
  detail: string | null
  /**
   * How much of today is leave: 0, 0.5 or 1. A half day and a whole day are
   * both ON_LEAVE with the same detail string, so this is the only thing that
   * separates them.
   */
  leaveFraction: number
}

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

export interface AttendanceEmployeeRef {
  id: string
  fullName: string
  employeeCode: string
  designation: string
}

export interface ApprovalItem {
  id: string
  employee: AttendanceEmployeeRef
  date: string
  checkIn: string | null
  checkOut: string | null
  workedHours: number | null
  isLate: boolean
  isEarlyOut: boolean
  approval: AttendanceApproval
  regularised: boolean
  regularisedNote: string | null
  exceptions: ExceptionCode[]
  agingDays: number
  stalled: boolean
}

export interface DailySummaryRow {
  employee: AttendanceEmployeeRef
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
  conflicts: Array<{
    employeeId: string
    fullName: string
    reason: "CHECKED_IN_WHILE_ON_LEAVE"
  }>
}

/** The payroll contract. Shape is frozen — see the attendance design doc. */
export interface MonthlyAttendanceSummary {
  employee: AttendanceEmployeeRef
  month: number
  year: number
  workingDays: number
  present: number
  absent: number
  onLeave: number
  notCheckedIn: number
  late: number
  earlyOut: number
  holidays: number
  weeklyOffs: number
  workedOnOffDays: number
  workedHours: number
  /**
   * `workedHours` restricted to scheduled working days. Divide this by
   * `workingDaysFullyRecorded`, never `workedHours` by `present` — those two
   * are drawn from different sets of days, so the quotient is not a rate.
   */
  workedHoursOnWorkingDays: number
  /** Working days attended and fully measured: both punches present. */
  workingDaysFullyRecorded: number
  expectedHours: number
  /**
   * `expectedHours` counted only up to today, so a month still running can be
   * compared against hours actually worked. Equal to `expectedHours` once the
   * month is over, so no caller needs to branch on which month it is showing.
   */
  expectedHoursToDate: number
  shortfallHours: number
  missingCheckOut: number
  pendingApproval: number
  approved: number
  regularised: number
  rejected: number
}

/**
 * Attendance reports. Mirrors `server/src/modules/attendance/attendance.report.ts`
 * — kept in sync by hand, like everything else in this file.
 *
 * One range serves the daily, weekly and custom reports; the granularity picks
 * which of `rows` and `days` is populated. Exactly one of them ever is.
 */
export type ReportGranularity = "summary" | "daily"

export interface AttendanceReportRow {
  employee: AttendanceEmployeeRef
  /** Its own field rather than part of the ref: that ref is shared with the
   *  approval and summary payloads, which do not carry this join. */
  department: string
  workingDays: number
  present: number
  absent: number
  onLeave: number
  onPaidLeave: number
  onUnpaidLeave: number
  notCheckedIn: number
  late: number
  earlyOut: number
  holidays: number
  weeklyOffs: number
  workedOnOffDays: number
  workedHours: number
  expectedHours: number
  shortfallHours: number
  missingCheckOut: number
  pendingApproval: number
  approved: number
  regularised: number
  rejected: number
}

export interface AttendanceReportDay {
  employee: AttendanceEmployeeRef
  department: string
  date: string
  status: AttendanceStatus
  isWorkingDay: boolean
  checkIn: string | null
  checkOut: string | null
  workedHours: number | null
  expectedHours: number
  isLate: boolean
  isEarlyOut: boolean
  approval: AttendanceApproval | null
  regularised: boolean
  autoCheckOut: boolean
  detail: string | null
}

export interface AttendanceReport {
  from: string
  to: string
  granularity: ReportGranularity
  /** Roster size, so an empty range reads differently from an empty company. */
  headcount: number
  rows: AttendanceReportRow[]
  days: AttendanceReportDay[]
  totals: {
    workingDays: number
    present: number
    absent: number
    onLeave: number
    notCheckedIn: number
    late: number
    earlyOut: number
    workedHours: number
    expectedHours: number
    shortfallHours: number
    missingCheckOut: number
    pendingApproval: number
  }
}

export interface HolidayItem {
  id: string
  name: string
  date: string
  type: HolidayType
}

export interface ImpactBlock {
  affectedEmployees: number
  affectedDates: string[]
  monthsTouched: string[]
}

export interface HolidayWriteResult {
  holiday: HolidayItem
  impact?: ImpactBlock
}

export interface AuditEntry {
  id: string
  action: string
  changedBy: string | null
  changedAt: string
  before: unknown
  after: unknown
  note: string | null
}

export interface BulkDecisionResult {
  id: string
  ok: boolean
  error?: string
}

// ── EVENT LOG ─────────────────────────────────
// Hand-mirrored from server/src/modules/event/event.types.ts.

export type EventSeverity = "INFO" | "SUCCESS" | "WARNING" | "ERROR"

export interface EventItem {
  id: string
  type: string
  severity: EventSeverity
  entity: string
  entityId: string
  title: string
  meta: string | null
  /**
   * **Role-agnostic** — `"/leave"`, not `"/employee/leave"`. One event row is
   * read by an employee, their manager and HR, so the client prefixes it with
   * its own route group.
   */
  href: string | null
  createdAt: string
}

export interface EventPage {
  items: EventItem[]
  nextCursor: string | null
}

// ── ANNOUNCEMENTS ─────────────────────────────

export type AnnouncementAudience = "ALL" | "DEPARTMENT" | "ROLE"

export interface AnnouncementItem {
  id: string
  title: string
  body: string
  audience: AnnouncementAudience
  departmentId: string | null
  departmentName: string | null
  targetRole: Role | null
  publishedBy: string
  /** Null is a draft; a future instant is scheduled. */
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateAnnouncementInput {
  title: string
  body: string
  audience: AnnouncementAudience
  departmentId?: string
  targetRole?: Role
  /** Omit to publish now; explicit `null` keeps it a draft. */
  publishedAt?: string | null
}

export type UpdateAnnouncementInput = Partial<CreateAnnouncementInput>

// ── DASHBOARD ─────────────────────────────────
// Hand-mirrored from server/src/modules/dashboard/dashboard.types.ts.

export type Tone = "green" | "yellow" | "red" | "neutral"

export interface DashboardStat {
  label: string
  /** Pre-formatted, money included. Never a raw number. */
  value: string
  sub: string
  tag: string
  tone: Tone
  /** Absent when the stat has no stored history, which is most of them. */
  trend?: number[]
  hotBar?: number
  href?: string
  failed?: boolean
  /** What the stat is about, as a meaning ("target", "margin"); the card maps it to an icon. */
  icon?: string
  /** The labelled row the stat sits in, when a page groups its stats. */
  group?: string
}

// `ChartBar` already exists at components/dashboard/types.ts:67 as
// `{ label, display, height }` and is what ChartCard consumes. Re-exported
// rather than redeclared, so there is one definition and the insights
// payload cannot drift from what the chart component accepts.
export type { ChartBar } from "@/components/dashboard/types"
import type { ChartBar } from "@/components/dashboard/types"

export interface DashboardTableCell {
  text?: string
  sub?: string
  weight?: number
  tag?: string
  tone?: Tone
}

export interface DashboardActivityItem {
  initial: string
  tone: Tone
  title: string
  meta: string
  status?: string
  statusTone?: Tone
  time: string
}

export interface TimeClockState {
  checkedIn: boolean
  /** The server's instant. Never re-seed a ticking clock from `new Date()`. */
  serverNow: string
  shift: string
  checkIn: string | null
  checkOut: string | null
  hoursToday: number | null
  canCheckIn: boolean
  canCheckOut: boolean
  detail: string | null
}

export interface DashboardPayload {
  role: Role
  greeting: {
    kicker: string
    heading: string
    sub: string
    cta: { label: string; href: string }
  }
  stats: DashboardStat[]
  chart?: { title: string; sub: string; bars: ChartBar[] }
  table?: {
    title: string
    headers: string[]
    rows: DashboardTableCell[][]
    href: string
  }
  feed?: DashboardActivityItem[]
  timeClock?: TimeClockState
  /** Nav badge counts keyed by nav href. */
  badges: Record<string, number>
}

// Payroll, expense and settlement types live in their own file; re-exported
// here so importers see a single module.
export * from "./payroll-types"

// ── DOCUMENTS & AVATAR ────────────────────────
// Hand-mirrored from server/src/modules/employee/employee.media.ts and the
// Prisma DocumentType enum.

export type DocumentType =
  | "CONTRACT"
  | "NID"
  | "CERTIFICATE"
  | "OFFER_LETTER"
  | "RESIGNATION"
  | "OTHER"

export interface DocumentItem {
  id: string
  type: DocumentType
  fileName: string
  bytes: number
  format: string
  uploadedAt: string
}

export interface SignedDocumentUrl {
  url: string
  expiresAt: string
}

// ── EMPLOYEE RECORD (tiered view) ─────────────
// Hand-mirrored from server/src/modules/employee/employee.types.ts. The
// server projects a row to one of five tiers depending on the caller's
// relationship to the subject, so every group below the required `work` is
// optional — a COLLEAGUE-tier row genuinely has no `employment`/`payroll`.

export interface WorkIdentity {
  fullName: string
  designation: string
  department: { id: string; name: string }
  reportingManager: { id: string; fullName: string } | null
  email: string
  phone: string | null
  avatarUrl: string | null
}

export interface PersonalIdentity {
  dateOfBirth: string | null
  gender: string | null
  nationalId: string | null
  bloodGroup: string | null
  maritalStatus: string | null
  /** Present only when a request is PENDING. */
  nationalIdChangeRequest?: {
    id: string
    newValue: string
    requestedAt: string
  } | null
}

export interface ContactDetails {
  presentAddress: string | null
  permanentAddress: string | null
  emergencyContact: string | null
}

export interface EmploymentDetails {
  employeeCode: string
  employmentType: EmploymentType
  employmentStatus: EmploymentStatus
  joiningDate: string
  officeLocation: string | null
  shift: { id: string; name: string } | null
  /**
   * Whether the login works — `User.isActive` on the server, NOT
   * `employmentStatus`. The two are independent: a current employee can have
   * a disabled account, and a resigned one can still have a live login until
   * it is revoked. Render both, never one in place of the other.
   */
  accountActive: boolean
  /** The second permission axis, held alongside `role`. Null means no Sales
      Hub access. Granting/revoking is HR/Super Admin only. */
  salesRole: SalesRole | null
  deviceUserId?: string | null
}

export interface PayrollDetails {
  salaryStructure: { id: string; name: string; currency: "BDT" | "USD" } | null
  bankAccountNumber: string | null
  bankName: string | null
  bankRoutingNumber: string | null
}

export interface ExitDetailsView {
  lastWorkingDay: string
  exitReason: string
  exitNote: string | null
}

export interface Blocker {
  field: string
  blocks: string
}

/**
 * Every group key is optional, matching the server's projection. A component
 * reading `employee.payroll.bankName` without a guard fails `tsc` rather than
 * crashing at runtime for a viewer whose tier never had it.
 */
export interface EmployeeView {
  id: string
  work: WorkIdentity
  personal?: PersonalIdentity
  contact?: ContactDetails
  employment?: EmploymentDetails
  payroll?: PayrollDetails
  exit?: ExitDetailsView | null
  documents?: DocumentItem[]
  blockers?: Blocker[]
  editableFields: string[]
}

/**
 * Live sessions behind one account.
 *
 * **No "signed in since" here, and none is coming from the server.** Refresh
 * tokens rotate on every refresh, so a token's age is the time since its last
 * rotation, not since the session began. `count` and `lastActiveAt` are the
 * two things that survive that; anything phrased as a sign-in time would be
 * inventing one.
 */
export interface AccountSessions {
  count: number
  lastActiveAt: string | null
}

/** One live sign-in. `sessionId` survives token rotation; the raw token never leaves the cookie. */
export interface SessionView {
  sessionId: string
  /** "Chrome on Windows", or "Unknown device". Derived server-side from the user agent. */
  device: string
  ipAddress: string | null
  startedAt: string
  lastUsedAt: string
  /** The session reading this list. The server refuses to revoke it. */
  current: boolean
}

/** Name and photo for an account with no employee record. Null for staff. */
export interface AccountIdentity {
  displayName: string | null
  avatarUrl: string | null
}

export interface MyProfileResponse {
  account: {
    email: string
    role: Role
    mustChangePassword: boolean
    /** When the account was opened, not when the person joined. */
    createdAt: string
    sessions: AccountSessions
    /** Set only by accounts with no employee record — staff get their name and photo from HR. */
    displayName: string | null
    avatarUrl: string | null
  }
  employee: EmployeeView | null
}

export interface UpdateEmployeeInput {
  phone?: string | null
  presentAddress?: string | null
  emergencyContact?: string | null
  maritalStatus?: string | null
  bloodGroup?: string | null
  fullName?: string
  dateOfBirth?: string | null
  gender?: string | null
  nationalId?: string | null
  permanentAddress?: string | null
  designation?: string
  departmentId?: string
  reportingManagerId?: string | null
  employmentType?: EmploymentType
  joiningDate?: string
  officeLocation?: string | null
  shiftId?: string | null
  deviceUserId?: string | null
  bankAccountNumber?: string | null
  bankName?: string | null
  bankRoutingNumber?: string | null
}

// ── EMPLOYEE INSIGHTS ─────────────────────────
// Hand-mirrored from server/src/modules/employee/employee.insights.ts. Every
// group is optional because the server projects it by tier: FINANCE gets
// `money` only, MANAGER gets `personal` (and `team` when the subject has
// subordinates), FULL gets all three, and every other tier 403s outright.

export interface EmployeeInsights {
  /** The shared axis, e.g. ["Mar","Apr","May","Jun","Jul","Aug"]. */
  months: string[]
  /** FULL and MANAGER. */
  personal?: {
    attendanceRate: ChartBar[]
    lateArrivals: ChartBar[]
    leaveDaysTaken: ChartBar[]
  }
  /** FULL and FINANCE. */
  money?: {
    netPay: ChartBar[]
    expenseClaims: ChartBar[]
  }
  /** FULL and MANAGER, and only when the subject has subordinates. */
  team?: {
    teamSize: ChartBar[]
    leaveDecisions: ChartBar[]
  }
}

// ── ASSETS ────────────────────────────────────
// Hand-mirrored from server/src/modules/asset/*.ts and the Prisma Asset*
// models. Money is a string everywhere here — Prisma.Decimal serializes to
// its string form, never a number.

export type AssetComputedStatus =
  | "RETIRED"
  | "LOST"
  | "IN_REPAIR"
  | "ASSIGNED"
  | "AVAILABLE"

export type AssetCondition = "NEW" | "GOOD" | "FAIR" | "DAMAGED"

export type AssetLifecycle = "IN_SERVICE" | "LOST" | "RETIRED"

export type AssetAttachmentKind =
  | "PHOTO"
  | "INVOICE"
  | "WARRANTY"
  | "CONDITION_OUT"
  | "CONDITION_IN"

export type AssetClassification = "IT" | "NON_IT"
export type AssetRequestKind = "NEW_ITEM" | "REPAIR" | "RETURN"
export type AssetRequestStatus =
  | "PENDING"
  | "APPROVED"
  | "ORDERED"
  | "REJECTED"
  | "CANCELLED"
  | "FULFILLED"
export type AssetRequestStage =
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "ORDERED"
  | "IN_REPAIR"
  | "AWAITING_COLLECTION"
  | "DONE"
  | "REJECTED"
  | "CANCELLED"

export interface AssetRequestTimelineEntry {
  action: string
  at: string
  byUserId: string | null
  note: string | null
}

export interface AssetHeldBy {
  assignmentId: string
  employeeId: string
  employeeCode: string
  fullName: string
  assignedAt: string
  conditionOut: AssetCondition
  acknowledgedAt: string | null
}

/**
 * `listAssets` / `getAsset` send the Prisma `category` relation as-is —
 * there is no server-side flattening to a bare `categoryName` string, so the
 * client does not invent one either.
 */
export interface Asset {
  id: string
  assetTag: string
  name: string
  categoryId: string
  category: { id: string; code: string; name: string }
  serialNumber: string | null
  model: string | null
  status: AssetComputedStatus
  heldBy: AssetHeldBy | null
  location: string | null
  /** The owning cost centre, not the holder's. No `departmentName` — `listAssets` does not include the relation, only `getAsset` (as `AssetDetail.department`) does. */
  departmentId: string | null
  /**
   * Absent — not null — for Manager and Employee. The server omits the field
   * rather than nulling it, so `"purchaseCost" in asset` is the honest test.
   */
  purchaseCost?: string
  vendor?: string
  currency: Currency
  warrantyExpiry: string | null
  /**
   * Null until Finance capitalises it — the ledger half of the register.
   *
   * **Nullable, not absent**, unlike `purchaseCost` above. That distinction is
   * the whole point: absence there is a *permission* fact (`stripCosts` drops
   * the field for roles that may not see money), whereas null here is a *state*
   * fact — the asset really has no capitalisation date. `listAssets` spreads
   * the row straight through, so these four always arrive.
   *
   * Typed `?: string` they invited `!== undefined`, which is true of null, so
   * every asset read as capitalised: the Capitalise button vanished and Pay
   * 409'd. Note that `string | null` does **not** make that comparison an
   * error — TS permits `!== undefined` against any nullable type, and no
   * type-aware ESLint rules are enabled here. The type documents the wire
   * shape; `ledgerStateOf` in `components/asset/asset-shared.ts` is the guard.
   */
  capitalisedAt: string | null
  capitalisedBy: string | null
  /** Frozen at capitalisation; 1.000000 for a BDT asset. Null until then. */
  fxRateToBdt: string | null
  purchaseCostBdt: string | null
  /** True once the payable raised at capitalisation has been cleared. Only
   *  present for roles that can see costs — the server omits it otherwise. */
  paid?: boolean
}

export interface AssetCategory {
  id: string
  code: string
  name: string
  requiresSerial: boolean
  isConsumable: boolean
  classification: AssetClassification
  tracksIndividually: boolean
  usefulLifeMonths: number | null
}

/**
 * Raw AssetAssignment row. `asset` / `employee` are populated on the reads
 * that include them (`getMyHoldings`, `listUnacknowledged`) and absent on the
 * write endpoints (`assignAsset`, `returnAsset`, `acknowledgeAssignment`).
 */
export interface AssetAssignment {
  id: string
  assetId: string
  employeeId: string
  assignedAt: string
  assignedBy: string
  conditionOut: AssetCondition
  issueNote: string | null
  acknowledgedAt: string | null
  returnedAt: string | null
  returnedTo: string | null
  conditionIn: AssetCondition | null
  returnNote: string | null
  asset?: {
    id: string
    assetTag: string
    name: string
    category: { id: string; name: string }
  }
  employee?: { id: string; fullName: string; employeeCode: string }
}

/**
 * Raw AssetRequest row. `category` / `employee` are populated by
 * `listAssetRequests`, absent on the write endpoints.
 */
export interface AssetRequest {
  id: string
  employeeId: string
  kind: AssetRequestKind
  categoryId: string | null
  assetId: string | null
  quantity: number | null
  reason: string
  status: AssetRequestStatus
  stage: AssetRequestStage
  decidedBy: string | null
  decidedAt: string | null
  decisionNote: string | null
  expectedBy: string | null
  orderNote: string | null
  fulfilledAt: string | null
  fulfilledBy: string | null
  fulfilledAssetId: string | null
  fulfilledNote: string | null
  createdAt: string
  category?: { id: string; name: string }
  employee?: { id: string; fullName: string; employeeCode: string }
}

/** Raw AssetRepair row. `asset` is populated by `listRepairs` only. */
export interface AssetRepair {
  id: string
  assetId: string
  sentAt: string
  sentBy: string
  vendor: string | null
  fault: string
  expectedBack: string | null
  isWarranty: boolean
  returnedAt: string | null
  cost: string | null
  currency: Currency
  outcome: string | null
  conditionAfter: AssetCondition | null
  asset?: {
    id: string
    assetTag: string
    name: string
    category: { id: string; name: string }
  }
}

export interface AssetAttachment {
  id: string
  assetId: string | null
  assignmentId: string | null
  kind: AssetAttachmentKind
  publicId: string
  fileName: string
  bytes: number
  format: string
  uploadedBy: string | null
  uploadedAt: string
}

/**
 * What `getAsset` returns — `Asset` plus the relations only the single-asset
 * read includes: the resolved `department`, and the full history the detail
 * sheet's timeline is built from. `listAssets` returns bare `Asset` rows with
 * none of this, which is why the two are separate types rather than one with
 * optional fields.
 */
export interface AssetDetail extends Asset {
  notes: string | null
  purchaseDate: string | null
  department: { id: string; name: string } | null
  retiredAt: string | null
  retirementNote: string | null
  assignments: AssetAssignment[]
  repairs: AssetRepair[]
  attachments: AssetAttachment[]
}

export interface AssetImportIssue {
  rowNumber: number
  column: string | null
  message: string
}

export interface AssetImportPreview {
  rows: unknown[]
  issues: AssetImportIssue[]
  summary: Record<string, number>
}

export interface AssetImportCommitResult {
  assetCount: number
  assignmentCount: number
}

export interface CreateAssetInput {
  categoryId: string
  name: string
  assetTag?: string
  serialNumber?: string
  model?: string
  notes?: string
  purchaseDate?: string
  purchaseCost?: number
  currency?: Currency
  vendor?: string
  warrantyExpiry?: string
  departmentId?: string
  location?: string
}

export type UpdateAssetInput = Partial<CreateAssetInput>

/**
 * Required on retire and mark-lost. Retiring an asset is a write-off and
 * marking one lost is an accusation; neither should be possible without a
 * sentence saying why.
 */
export interface AssetLifecycleInput {
  note: string
  /** Decision 4: optional recovery priced where the facts are fresh. */
  recovery?: { amount: string; currency?: Currency; reason: string; kind?: AssetRecoveryKind }
}

export interface CreateAssetCategoryInput {
  code: string
  name: string
  requiresSerial?: boolean
  isConsumable?: boolean
  usefulLifeMonths?: number | null
}

export type UpdateAssetCategoryInput = Partial<Omit<CreateAssetCategoryInput, "code">>

export interface AssignAssetInput {
  employeeId: string
  conditionOut: AssetCondition
  issueNote?: string
}

export interface ReturnAssetInput {
  conditionIn: AssetCondition
  returnNote?: string
  /** Decision 4: optional recovery offered on a damaged return. */
  recovery?: { amount: string; currency?: Currency; reason: string; kind?: AssetRecoveryKind }
}

export interface SendAssetRepairInput {
  fault: string
  vendor?: string
  expectedBack?: string
  isWarranty?: boolean
}

export interface ReceiveAssetRepairInput {
  cost?: number
  currency?: Currency
  outcome?: string
  conditionAfter?: AssetCondition
}

export type SubmitAssetRequestInput =
  | { kind: "NEW_ITEM"; categoryId: string; quantity?: number; reason: string }
  | { kind: "REPAIR" | "RETURN"; assetId: string; reason: string }

export interface ApproveAssetRequestInput {
  note?: string
}

export interface RejectAssetRequestInput {
  note: string
}

export interface FulfilAssetRequestInput {
  assetId?: string
  note?: string
}

// ── OPERATING COSTS ───────────────────────────
// Hand-mirrored from server/src/modules/cost/*.ts and the Prisma
// CostCategory/CostCommitment/OperatingCost/CostAttachment models. Money is a
// string everywhere here — Prisma.Decimal serializes to its string form,
// never a number. `isOverdue` is a derived field computed server-side on
// every read (cost.derive.ts) — there is no stored overdue status, and this
// client never recomputes one.

export type CostStatus = "PENDING" | "PAID"

export interface CostCategory {
  id: string
  code: string
  name: string
}

/**
 * `category` is populated by `listCostCommitments` (which includes the
 * relation) and absent from `createCostCommitment`/`updateCostCommitment`,
 * which return the raw row.
 */
export interface CostCommitment {
  id: string
  categoryId: string
  category?: CostCategory
  label: string
  payee: string
  /** Null on purpose — rent and wifi are fixed, electricity and water are not. */
  amount: string | null
  currency: Currency
  dueDay: number | null
  startedOn: string
  /** Null means still running. A commitment is ended, never deleted. */
  endedOn: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface CostAttachment {
  id: string
  costId: string
  publicId: string
  fileName: string
  bytes: number
  format: string
  uploadedBy: string | null
  uploadedAt: string
}

/**
 * `category` and `commitment` are populated by `listCosts`/`getCost`, which
 * include both relations. `attachments` is populated by `getCost` only.
 * `isOverdue`: PENDING and past its `dueDate` — computed by the server on
 * every read, rendered as-is here, never recomputed.
 */
export interface CostBill {
  id: string
  categoryId: string
  category: CostCategory
  commitmentId: string | null
  commitment: CostCommitment | null
  label: string
  payee: string
  /** The month this bill is FOR, distinct from when it was paid. */
  periodMonth: number
  periodYear: number
  amount: string
  currency: Currency
  dueDate: string | null
  status: CostStatus
  paidAt: string | null
  paidBy: string | null
  paymentRef: string | null
  notes: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  isOverdue: boolean
  attachments?: CostAttachment[]
}

export interface CostCategoryTotal {
  categoryId: string
  categoryName: string
  /** Two currencies under one category are two rows, never one. */
  currency: Currency
  total: string
  paid: string
  outstanding: string
  billCount: number
}

export interface CostCurrencyTotal {
  currency: Currency
  total: string
  paid: string
  outstanding: string
}

export interface CostSummary {
  categories: CostCategoryTotal[]
  /**
   * One entry per currency present in the month — almost always just BDT.
   * Never a single scalar: adding a USD hosting bill to BDT rent produces a
   * figure that is not money in either currency, and this is the headline
   * number on the screen. Empty for a month with no bills.
   */
  totals: CostCurrencyTotal[]
  overdueCount: number
}

export interface CreateCostCategoryInput {
  code: string
  name: string
}

export type UpdateCostCategoryInput = Partial<Omit<CreateCostCategoryInput, "code">>

export interface CreateCommitmentInput {
  categoryId: string
  label: string
  payee: string
  amount?: number
  currency?: Currency
  dueDay?: number
  startedOn: string
  notes?: string
}

export interface UpdateCommitmentInput {
  label?: string
  payee?: string
  amount?: number | null
  currency?: Currency
  dueDay?: number | null
  notes?: string
  /** Ends the commitment. Never a delete — the bills it explains still exist. */
  endedOn?: string | null
}

export interface CreateCostInput {
  categoryId: string
  commitmentId?: string
  label: string
  payee: string
  periodMonth: number
  periodYear: number
  amount: number
  currency?: Currency
  dueDate?: string
  notes?: string
}

// The period a bill is FOR and the commitment it is linked to are set once,
// at creation — changing either after the fact is a different bill, not an
// edit of this one, so neither appears here.
export interface UpdateCostInput {
  categoryId?: string
  label?: string
  payee?: string
  amount?: number
  currency?: Currency
  dueDate?: string | null
  notes?: string
}

export interface PayCostInput {
  paidAt?: string
  paymentRef?: string
}

export interface CostImportIssue {
  rowNumber: number
  column: string | null
  message: string
}

export interface CostImportPreview {
  rows: unknown[]
  issues: CostImportIssue[]
  summary: Record<string, number>
}

export interface CostImportCommitResult {
  costCount: number
  paidCount: number
}

// ── USER ACCOUNTS ─────────────────────────────
// Hand-mirrored from server/src/modules/auth/user.service.ts. Account-level
// fields only — employment lives on EmployeeView, which /admin/employees
// owns. `employee` is null for the three administrative roles, which have no
// Employee row at all.

export interface UserAccount {
  id: string
  email: string
  role: Role
  /** false is the soft delete: locked out, row and history preserved. */
  isActive: boolean
  mustChangePassword: boolean
  createdAt: string
  employee: { id: string; employeeCode: string; fullName: string } | null
}

/** Narrower than Role: employee-tier accounts go through the Add-employee form. */
export interface CreateUserInput {
  email: string
  role: "SUPER_ADMIN" | "HR_ADMIN" | "FINANCE_OFFICER"
}

export interface CreateUserResult {
  id: string
  email: string
  role: Role
  /** Shown once, never retrievable again. */
  temporaryPassword: string
}

// ── Reference data written from the Settings screens ──────────────────────
// Hand-mirrored from the server's Zod schemas, like every other type here.
// There is no shared package; that is deliberate.

export interface DepartmentInput {
  name: string
  costNature?: "DIRECT" | "ADMINISTRATIVE"
}

/** The whole `Shift` row. The server returns all of it since Project B. */
export interface Shift {
  id: string
  name: string
  startTime: string
  endTime: string
  breakMinutes: number
  graceMinutes: number
  /** 0=Sun … 6=Sat. `[5]` is Friday. */
  weeklyOffDays: number[]
  effectiveFrom: string | null
  effectiveTo: string | null
}

export interface ShiftInput {
  name: string
  startTime: string
  endTime: string
  breakMinutes?: number
  graceMinutes?: number
  weeklyOffDays?: number[]
}

/**
 * Every field optional and NO defaults applied — the server's update schema is
 * built from a defaults-free field set on purpose, so a PATCH writes only what
 * it carries. Sending a field here means intending to change it.
 */
export type ShiftUpdateInput = Partial<ShiftInput>

/**
 * Returned only when `weeklyOffDays` actually changed. Nothing else about a
 * shift rewrites history: `isLate` is decided at punch time and stored, while
 * weekly-off days are re-derived on every read.
 */
export interface ShiftImpact {
  affectedEmployees: number
  earliestAffectedDate: string | null
}

export interface ShiftWriteResult {
  shift: Shift
  impact?: ShiftImpact
}

export interface CreateLeaveTypeInput {
  code: string
  name: string
  annualQuota: number
  eligibleFor: EmploymentType[]
  isPaid?: boolean
  carryForwardPct?: number
  maxConsecutive?: number | null
  allowsBackdating?: boolean
  countsHolidays?: boolean
  accrualBasis?: LeaveAccrualBasis
  minServiceMonths?: number
  maxAccrual?: number | null
  allowsHalfDay?: boolean
}

/** `code` is immutable, and `statutory` is never settable through the API. */
export type UpdateLeaveTypeInput = Partial<Omit<CreateLeaveTypeInput, "code">>

// ── ACCOUNTING ──────────────────────────────────────────────────────
// Hand-mirrored from server/src/modules/accounting/accounting.types.ts and
// the Prisma models. No shared package, deliberately — keep these in step
// by hand when the server changes.

export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE"
export type AccountCashKind = "NONE" | "CASH" | "BANK"
export type JournalStatus = "DRAFT" | "PENDING_APPROVAL" | "POSTED" | "REVERSED"
export type JournalType = "OPENING" | "MANUAL" | "SYSTEM" | "REVERSAL" | "CLOSING"
export type PeriodStatus = "OPEN" | "CLOSED" | "LOCKED"
export type FinancialYearStatus = "OPEN" | "CLOSED"

export interface Account {
  id: string
  code: string
  name: string
  type: AccountType
  parentId: string | null
  isGroup: boolean
  cashKind: AccountCashKind
  isActive: boolean
  systemRole: string | null
  description: string | null
}

export interface AccountNode extends Omit<Account, "parentId"> {
  children: AccountNode[]
}

export interface CreateAccountInput {
  code: string
  name: string
  type: AccountType
  parentId?: string
  isGroup?: boolean
  cashKind?: AccountCashKind
  description?: string
}

export interface UpdateAccountInput {
  name?: string
  parentId?: string | null
  cashKind?: AccountCashKind
  isActive?: boolean
  description?: string | null
}

export interface Customer {
  id: string
  legalName: string
  billingAddress: string | null
  bin: string | null
  paymentDays: number
  salesAccountId: string | null
  createdAt: string
}

export interface Supplier {
  id: string
  name: string
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  bin: string | null
  paymentDays: number
  isActive: boolean
  createdAt: string
}

export interface VatCode {
  id: string
  code: string
  name: string
  ratePercent: string
  isActive: boolean
}

export type SupplierDocStatus = "DRAFT" | "APPROVED" | "REVERSED"

export interface SupplierBillLine {
  id: string
  description: string
  kind: "GOODS" | "SERVICE"
  amount: string
  sourceAmount: string | null
  vatCodeId: string
  vatAmount: string
}

/**
 * The one deal a bill belongs to now lives on the bill itself, not on each
 * line (Task 12) — `opportunityId` moved off `SupplierBillLine` onto here.
 */
export interface SupplierBill {
  id: string
  supplierId: string
  billNumber: string
  date: string
  dueDate: string
  currency: "BDT" | "USD"
  fxRateToBdt?: string | null
  status: SupplierDocStatus
  opportunityId: string
  createdBy?: string
  approvedBy?: string | null
  approvedAt?: string | null
  lines: SupplierBillLine[]
}

/**
 * `listSupplierBills` (`GET /api/supplier-bills`) uses an explicit Prisma
 * `select` that was never extended to include `opportunityId` or the
 * approval/send-back fields when those were added — narrower than the full
 * row `getSupplierBill`/`createSupplierBill`/`updateSupplierBill` return.
 * Kept as its own type rather than papering over the gap with optional
 * fields on `SupplierBill`.
 */
export interface SupplierBillListRow {
  id: string
  supplierId: string
  billNumber: string
  date: string
  dueDate: string
  currency: "BDT" | "USD"
  fxRateToBdt: string | null
  status: SupplierDocStatus
  createdBy: string
  lines: SupplierBillLine[]
}

export interface SupplierPaymentAllocation {
  id: string
  billId: string
  amount: string
  amountUsd: string | null
  /** Only present when the payment is loaded through `reverseSupplierPayment` — the bill it settles, named. */
  bill?: { id: string; billNumber: string }
}

export interface SupplierPayment {
  id: string
  supplierId: string
  /** The one deal this payment belongs to (spec: every document belongs to one deal). */
  opportunityId: string
  date: string
  amount: string
  sourceAmount: string | null
  currency: "BDT" | "USD"
  fxRateToBdt: string | null
  reference: string | null
  status: SupplierDocStatus
  approvedBy: string
  approvedAt: string
  /** Set only once a Super Admin reverses this payment. */
  reversedBy: string | null
  reversedAt: string | null
  reversalReason: string | null
  createdBy: string
  allocations: SupplierPaymentAllocation[]
  /** Only present on `createSupplierPayment`'s response (`name` only) and
   *  `reverseSupplierPayment`'s (`id` and `name`) — list/get do not include it. */
  supplier?: { id?: string; name: string }
}

export interface SupplierCreditNoteLine {
  id: string
  billLineId: string
  amount: string
  vatAmount: string
}

export interface SupplierCreditNote {
  id: string
  billId: string
  supplierId: string
  date: string
  reason: string
  status: SupplierDocStatus
  createdBy: string
  lines: SupplierCreditNoteLine[]
}

export type AgeingBucket = "Not due" | "1-30" | "31-60" | "61-90" | "Over 90"

export interface SupplierAgeingRow {
  billId: string | null
  openingBalanceId: string | null
  label: string
  supplierId: string
  supplierName: string
  dueDate: string
  outstanding: string
  bucket: AgeingBucket
}

export interface SupplierControlTieOut {
  subledgerTotal: string
  glBalance: string
  ties: boolean
}

/* -------------------------------------------------------------------------- */
/* Receivables & payables, Phase 3a (Selling) and Phase 3b (Earned revenue)    */
/* -------------------------------------------------------------------------- */

export type SaleLineKind = "GOODS" | "SERVICE"
export type CustomerPoStatus = "OPEN" | "COMPLETE" | "CANCELLED"
export type ReceivableDocStatus = "DRAFT" | "APPROVED" | "REVERSED"

export interface CustomerPoLine {
  id: string
  description: string
  kind: SaleLineKind
  quantity: string
  unitPrice: string
  amount: string
  vatCodeId: string
  vatCode: VatCode
  order: number
  /** Draft and approved invoice lines, for working out what is left to invoice. */
  invoiceLines: Array<{ amount: string }>
}
export interface CustomerPo {
  id: string
  serial: string
  customerPoNumber: string
  date: string
  invoiceTo: string | null
  status: CustomerPoStatus
  cancelReason: string | null
  createdBy: string
  customer: { id: string; legalName: string }
  opportunity: { id: string; serial: string; name: string }
  lines: CustomerPoLine[]
}
export interface PrefillLine { description: string; kind: "GOODS"; quantity: string; unitPrice: string | null }

export interface InvoiceablePo {
  id: string
  serial: string
  customerPoNumber: string
  customer: { id: string; legalName: string }
  opportunity: { id: string; serial: string; name: string }
  lines: Array<{ id: string; description: string; kind: SaleLineKind; amount: string; vatCodeId: string; remaining: string }>
}
export interface InvoiceLine {
  id: string
  poLineId: string
  description: string
  amount: string
  vatCodeId: string
  vatAmount: string
  poLine: { kind: SaleLineKind }
  vatCode: VatCode
}
export interface Invoice {
  id: string
  invoiceNumber: string
  date: string
  dueDate: string
  status: ReceivableDocStatus
  createdBy: string
  customer: { id: string; legalName: string }
  po: { id: string; serial: string; customerPoNumber: string; opportunity: { id: string; serial: string; name: string } }
  lines: InvoiceLine[]
}

export interface Receipt {
  id: string
  /** The one deal this receipt belongs to (spec: every document belongs to one deal). */
  opportunityId: string
  date: string
  amount: string
  reference: string | null
  status: ReceivableDocStatus
  approvedBy: string
  approvedAt: string
  /** Set only once a Super Admin reverses this receipt. */
  reversedBy: string | null
  reversedAt: string | null
  reversalReason: string | null
  createdBy: string
  vdsAmount: string
  vdsCertificateRef: string | null
  vdsCertificateDate: string | null
  aitAmount: string
  aitCertificateRef: string | null
  aitCertificateDate: string | null
  customer: { id: string; legalName: string }
  allocations: Array<{ id: string; receiptId: string; invoiceId: string; amount: string; createdAt: string; invoice: { id: string; invoiceNumber: string } }>
}

export interface CustomerCreditNote {
  id: string
  date: string
  reason: string
  status: ReceivableDocStatus
  createdBy: string
  invoice: { id: string; invoiceNumber: string }
  customer: { id: string; legalName: string }
  lines: Array<{ id: string; invoiceLineId: string; amount: string; vatAmount: string }>
}

export interface CustomerAgeingRow {
  invoiceId: string | null
  openingBalanceId: string | null
  label: string
  customerId: string
  customerName: string
  dealSerial: string | null
  dueDate: string
  outstanding: string
  bucket: AgeingBucket
}
export interface CustomerTieOut { subledgerTotal: string; glBalance: string; ties: boolean; advancesHeld: string }

export interface StatementEntry {
  date: string
  kind: "Opening balance" | "Invoice" | "Receipt" | "Credit note"
  reference: string
  debit: string | null
  credit: string | null
  balance: string
}
export interface CustomerStatement {
  customer: { legalName: string; billingAddress: string | null; bin: string | null }
  from: string
  to: string
  openingBalance: string
  entries: StatementEntry[]
  closingBalance: string
}

/* -------------------------------------------------------------------------- */
/* Deal Money (deal-money-simplify)                                           */
/* -------------------------------------------------------------------------- */
// Hand-mirrored from server/src/modules/dealMoney/*.ts. No shared package,
// deliberately — keep these in step by hand.

/**
 * A customer credit note as it appears nested under a deal's invoice
 * (`invoice.creditNotes`, from `dealMoney.types.ts`'s `DEAL_INVOICE_INCLUDE`
 * — `{ include: { lines: true } }`, so no `invoice`/`customer` relation,
 * since the parent invoice is already known). Distinct from
 * `CustomerCreditNote` above, which is shaped for the standalone
 * `/api/customer-credit-notes` endpoints and does carry those.
 */
export interface DealMoneyCustomerCreditNote {
  id: string
  invoiceId: string
  customerId: string
  date: string
  reason: string
  status: ReceivableDocStatus
  approvedBy: string | null
  approvedAt: string | null
  rejectionNote: string | null
  sentBackBy: string | null
  sentBackAt: string | null
  createdBy: string
  lines: Array<{ id: string; creditNoteId: string; invoiceLineId: string; amount: string; vatAmount: string }>
}

/**
 * An invoice as it appears in the Money section: the same shape as
 * `Invoice` above (`DEAL_INVOICE_INCLUDE` extends `INVOICE_INCLUDE`), plus
 * the allocations (approved receipts only, amount only) and credit notes
 * the Money section's numbers are worked out from.
 */
export interface DealMoneyInvoice extends Invoice {
  allocations: Array<{ amount: string }>
  creditNotes: DealMoneyCustomerCreditNote[]
}

/**
 * A supplier bill as it appears in the Money section (`DEAL_BILL_INCLUDE`):
 * its own lines, its supplier, its payment allocations (approved payments
 * only, amount only) and its credit notes — a different, richer shape than
 * `SupplierBill`/`SupplierBillListRow` above, which serve the bill create /
 * edit / list screens.
 */
export interface DealMoneySupplierBill {
  id: string
  supplierId: string
  billNumber: string
  date: string
  dueDate: string
  currency: "BDT" | "USD"
  fxRateToBdt: string | null
  status: SupplierDocStatus
  approvedBy: string | null
  approvedAt: string | null
  opportunityId: string
  rejectionNote: string | null
  sentBackBy: string | null
  sentBackAt: string | null
  createdBy: string
  supplier: { id: string; name: string }
  lines: SupplierBillLine[]
  allocations: Array<{ amount: string }>
  creditNotes: SupplierCreditNote[]
}

export interface DealMoneyNumbers {
  sold: string
  stillOwed: string
  /** Null for anyone who cannot see cost (`canSeeCost` false) — never "0.00". */
  cost: string | null
  profit: string | null
}

export interface DealMoneyProductLine {
  id: string
  product: string
  model: string | null
  quantity: number | null
  supplier: { id: string; name: string } | null
}

/**
 * The deal Money section's one payload, shown on both the deal page's Money
 * section and the standalone deal money page. Mirrors
 * `server/src/modules/dealMoney/dealMoney.types.ts`'s `DealMoney`.
 *
 * `bills` and `supplierPayments` are null, not empty arrays, for a viewer
 * who cannot see cost (`canSeeCost` false) — the server skips those queries
 * entirely rather than hiding a real empty result.
 */
export interface DealMoney {
  deal: {
    id: string
    serial: string
    name: string
    customer: { id: string; legalName: string; billingAddress: string | null; paymentDays: number } | null
  }
  canSeeCost: boolean
  canEdit: boolean
  numbers: DealMoneyNumbers
  pos: CustomerPo[]
  bills: DealMoneySupplierBill[] | null
  /** `allocations[].bill` is always populated here (`DEAL_PAYMENT_INCLUDE`); `supplier` is always absent. */
  supplierPayments: SupplierPayment[] | null
  invoices: DealMoneyInvoice[]
  receipts: Receipt[]
  productLines: DealMoneyProductLine[]
}

/** One row of the Deals Won list (`dealMoney.list.ts`'s `listDealMoney`). */
export interface DealMoneyListRow {
  id: string
  serial: string
  name: string
  customerName: string | null
  sold: string
  cost: string
  profit: string
  stillOwed: string
  /** Draft invoices, bills and credit notes waiting on this deal. */
  waiting: number
}

export interface DealMoneyListResult {
  rows: DealMoneyListRow[]
  total: number
}

/** Every kind of draft document the Waiting-for-approval queue can list. */
export type DealApprovalKind = "INVOICE" | "SUPPLIER_BILL" | "CUSTOMER_CREDIT_NOTE" | "SUPPLIER_CREDIT_NOTE"

/**
 * Narrower than `DealApprovalKind`: `dealMoney.sendBack.ts` refuses both
 * credit-note kinds (neither has an update or delete path, so a sent-back
 * credit note could never be fixed or re-approved), and the route itself
 * rejects them before the service runs.
 */
export type DealSendBackKind = "INVOICE" | "SUPPLIER_BILL"

export interface WaitingForApprovalRow {
  kind: DealApprovalKind
  id: string
  number: string
  dealId: string
  dealSerial: string
  party: string
  amount: string
  preparedBy: string
  preparedAt: string
}

/**
 * Not a VAT return — the app records VAT, it does not file it
 * (`dealMoney.vatSummary.ts`).
 */
export interface DealVatSummary {
  onInvoices: string
  onBills: string
  difference: string
  withheldByCustomers: string
}

export interface AccountingPeriod {
  id: string
  financialYearId: string
  year: number
  month: number
  startDate: string
  endDate: string
  status: PeriodStatus
  closedBy: string | null
  closedAt: string | null
  reopenedBy: string | null
  reopenedAt: string | null
  reopenReason: string | null
}

export interface FinancialYear {
  id: string
  name: string
  startDate: string
  endDate: string
  status: FinancialYearStatus
  closedBy: string | null
  closedAt: string | null
  periods: AccountingPeriod[]
}

export interface JournalLine {
  id: string
  accountId: string
  account: { id: string; code: string; name: string; type: AccountType }
  debit: string
  credit: string
  narration: string | null
  departmentId: string | null
  employeeId: string | null
  sourceCurrency: Currency | null
  sourceAmount: string | null
  fxRateToBdt: string | null
  sortOrder: number
}

export interface JournalAttachment {
  id: string
  fileName: string
  bytes: number
  format: string
  uploadedAt: string
}

/** Who did something, resolved to a name. Mirrors server/src/utils/actors.ts. */
export interface ActorName {
  id: string
  email: string
  fullName: string | null
}

export interface Journal {
  id: string
  journalNo: string
  date: string
  periodId: string
  period: { id: string; year: number; month: number; status: PeriodStatus }
  type: JournalType
  status: JournalStatus
  narration: string
  reference: string | null
  sourceModule: string | null
  sourceRefId: string | null
  sourceEvent: string | null
  createdBy: string
  createdAt: string
  submittedBy: string | null
  submittedAt: string | null
  approvedBy: string | null
  approvedAt: string | null
  /**
   * The three actor columns above are bare user ids — there is no relation
   * behind them server-side, so a name has to be resolved separately. Only
   * the single-journal endpoint sends these; the register does not, and
   * does not show them.
   */
  createdByUser?: ActorName | null
  submittedByUser?: ActorName | null
  approvedByUser?: ActorName | null
  postedAt: string | null
  rejectionNote: string | null
  reversesId: string | null
  reversalReason: string | null
  lines: JournalLine[]
  attachments: JournalAttachment[]
}

/** What the editor sends. Amounts are decimal strings; omit the unused side. */
export interface JournalLineInput {
  accountId: string
  debit?: string
  credit?: string
  narration?: string | null
  departmentId?: string | null
  employeeId?: string | null
}

export interface CreateJournalInput {
  date: string
  type?: "MANUAL" | "OPENING"
  narration: string
  reference?: string | null
  lines: JournalLineInput[]
}

export type UpdateJournalInput = Partial<Omit<CreateJournalInput, "type">>

export interface JournalQuery {
  from?: string
  to?: string
  accountId?: string
  status?: JournalStatus
  type?: JournalType
  sourceModule?: string
  departmentId?: string
  employeeId?: string
  q?: string
  page?: number
  pageSize?: number
}

export interface JournalPage {
  rows: Journal[]
  total: number
}

export interface LedgerRow {
  journalId: string
  journalNo: string
  date: string
  narration: string
  lineNarration: string | null
  reference: string | null
  sourceModule: string | null
  debit: string
  credit: string
  runningBalance: string
}

export interface LedgerResult {
  account: { id: string; code: string; name: string; type: AccountType }
  from: string
  to: string
  openingBalance: string
  rows: LedgerRow[]
  totalDebit: string
  totalCredit: string
  closingBalance: string
}

export interface TrialBalanceRow {
  accountId: string
  code: string
  name: string
  type: AccountType
  openingDebit: string
  openingCredit: string
  periodDebit: string
  periodCredit: string
  closingDebit: string
  closingCredit: string
}

export interface TrialBalanceResult {
  from: string
  to: string
  rows: TrialBalanceRow[]
  totals: {
    openingDebit: string
    openingCredit: string
    periodDebit: string
    periodCredit: string
    closingDebit: string
    closingCredit: string
  }
  isBalanced: boolean
}

// -- FINANCIAL STATEMENTS --------------------------------------------
// Hand-mirrored from server/src/modules/statements/statements.types.ts.
// No shared package, deliberately � keep these in step by hand.

export interface StatementPeriod {
  from: string
  to: string
  /** "July 2026" � the server labels it so the client need not re-derive it. */
  label: string
}

export interface BreakdownRow {
  accountId: string
  code: string
  name: string
  current: string
  comparative: string
}

export interface StatementLine {
  key: string
  label: string
  code: string | null
  current: string
  comparative: string
  kind: "LINE" | "SUBTOTAL" | "DERIVED"
  breakdown: BreakdownRow[]
}

export interface PnlResult {
  period: StatementPeriod
  comparative: StatementPeriod
  lines: StatementLine[]
  netProfit: { current: string; comparative: string }
}

export interface PositionSection {
  heading: string
  lines: StatementLine[]
  subtotal: { current: string; comparative: string }
}

export interface PositionResult {
  period: StatementPeriod
  comparative: StatementPeriod
  assets: PositionSection[]
  totalAssets: { current: string; comparative: string }
  equityAndLiabilities: PositionSection[]
  totalEquityAndLiabilities: { current: string; comparative: string }
  balances: boolean
}

export interface EquityColumn {
  accountId: string
  code: string
  name: string
}

export interface EquityRow {
  label: string
  /** Keyed by accountId, matching `columns`. */
  values: Record<string, string>
  total: string
  kind: "OPENING" | "MOVEMENT" | "PROFIT" | "CLOSING"
}

/** No comparative � the statement carries its own opening and closing. */
export interface EquityResult {
  period: StatementPeriod
  columns: EquityColumn[]
  rows: EquityRow[]
}

/** The shape of the 409 body when the trial balance does not agree. */
export interface UnbalancedDetails {
  debitTotal: string
  creditTotal: string
  difference: string
  to: string
}

export interface CashFlowRow { key: string; label: string; current: string; comparative: string; isSubtotal?: boolean }
export interface CashFlowResult { period: StatementPeriod; comparativePeriod: StatementPeriod; operating: CashFlowRow[]; investing: CashFlowRow[]; financing: CashFlowRow[]; summary: CashFlowRow[] }
export interface NoteRow { accountId: string; code: string; name: string; current: string; comparative: string }
export interface StatementNoteView { ref: string; title: string; body: string | null; rows: NoteRow[]; total: string | null; totalComparative: string | null }
export interface NotesResult { period: StatementPeriod; comparativePeriod: StatementPeriod; notes: StatementNoteView[] }
export interface AnnexureRow { accountId: string; particulars: string; rate: string | null; costOpening: string; costAddition: string; costClosing: string; depOpening: string; depCharged: string; depClosing: string; writtenDownValue: string }
export interface AnnexureResult { period: StatementPeriod; rows: AnnexureRow[]; total: Omit<AnnexureRow, "accountId" | "particulars" | "rate"> }
export interface PolicyNote { id: string; ref: string; title: string; body: string; sortOrder: number; updatedBy: string | null; updatedAt: string; createdAt: string }

// ── DEPRECIATION & ASSET VALUE ─────────────────
// Hand-mirrored from server/src/modules/depreciation/* and
// server/src/modules/asset/asset.value.ts.

export type DepreciationRunStatus = "DRAFT" | "POSTED" | "REVERSED"

export interface DepreciationRunCharge {
  id: string
  assetId: string
  amount: string
  openingBookValue: string
  rate: string
  months: number
  asset?: { assetTag: string; name: string; categoryName?: string }
}

export interface DepreciationRunDetail {
  id: string
  runNo: string
  year: number
  month: number
  status: DepreciationRunStatus
  journalId: string | null
  journal?: { journalNo: string } | null
  createdBy: string
  createdAt: string
  postedBy: string | null
  postedAt: string | null
  reversedBy: string | null
  reversedAt: string | null
  charges: DepreciationRunCharge[]
}

export interface DepreciationRunSummary {
  id: string
  runNo: string
  year: number
  month: number
  status: DepreciationRunStatus
  journalId: string | null
  chargeCount: number
  total: string
}

export interface DepreciationPreflightItem {
  code: string
  message: string
}

export interface DepreciationPreflight {
  blockers: DepreciationPreflightItem[]
  warnings: DepreciationPreflightItem[]
  ok: boolean
}

export type AssetValueRowStatus = "VALUED" | "UNKNOWN" | "NOT_CAPITALISED"

export interface AssetValueRow {
  assetId: string
  assetTag: string
  name: string
  categoryName: string
  currency: Currency
  purchaseCost: string | null
  accumulated: string | null
  bookValue: string | null
  status: AssetValueRowStatus
}

export interface AssetValueTotal {
  currency: Currency
  purchaseCost: string
  accumulated: string
  bookValue: string
}

export interface AssetValueReport {
  rows: AssetValueRow[]
  totals: AssetValueTotal[]
  asOf: string
}

// ── ASSET RECOVERIES & EXIT CHECKLIST ─────────
// Hand-mirrored from server/src/modules/asset/asset.recoveries.ts and
// server/src/modules/asset/asset.exit.ts.

export type AssetRecoveryKind = "NOT_RETURNED" | "DAMAGED" | "LOST"
export type AssetRecoveryStatus = "PENDING" | "RECOVERED" | "WAIVED"

export interface AssetRecovery {
  id: string
  assetId: string
  employeeId: string
  assignmentId: string | null
  kind: AssetRecoveryKind
  amount: string
  currency: Currency
  reason: string
  status: AssetRecoveryStatus
  waivedBy: string | null
  waivedAt: string | null
  waiverReason: string | null
  adjustmentId: string | null
  settlementId: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  asset?: { assetTag: string; name: string; category?: { name: string } }
  adjustment?: { payslip?: { payslipNo: string } | null } | null
  settlement?: { settlementNo: string } | null
}

export interface CreateRecoveryInput {
  assetId: string
  employeeId: string
  assignmentId?: string
  kind?: AssetRecoveryKind
  amount: string
  currency?: Currency
  reason: string
}

export interface UpdateRecoveryInput {
  amount?: string
  currency?: Currency
  reason?: string
}

export interface ExitChecklistOpenAssignment {
  assignmentId: string
  assetId: string
  assetTag: string
  assetName: string
  categoryName: string
  assignedAt: string
  conditionOut: string
  acknowledgedAt: string | null
}

export interface ExitChecklist {
  employeeId: string
  openAssignments: ExitChecklistOpenAssignment[]
  pendingRecoveries: AssetRecovery[]
  hasOutstanding: boolean
}

// ── EMAIL DISPATCH LOG ────────────────────────

/**
 * One attempted send. Hand-mirrored from the server's `DispatchItem` —
 * client and server share no validation package, so this is duplicated
 * deliberately and kept in sync by hand.
 *
 * Three states, not two: `sentAt` set means the mail server accepted it,
 * `error` set means it refused, and both null means the process died before
 * the send resolved. A boolean could not tell the last from the first.
 */
export interface EmailDispatch {
  id: string
  to: string
  kind: string
  subject: string
  entity: string | null
  entityId: string | null
  /** The mail server accepted it. NOT proof a person received it. */
  sentAt: string | null
  error: string | null
  createdAt: string
}

export interface EmailDispatchPage {
  items: EmailDispatch[]
  nextCursor: string | null
}

// ── SALES: OPPORTUNITIES, COMMENTS, TARGETS, DASHBOARD ────────────────────
// Hand-mirrored from server/src/modules/sales/sales.types.ts. There is no
// shared package between the two projects and that is deliberate, so a drift
// here surfaces as a runtime undefined rather than a type error. Read the two
// files side by side when changing either.

export type SalesTrack = "NETWORKING"

export type OpportunityStatus = "ONGOING" | "WON" | "LOST" | "CANCELLED"

/**
 * Each stage is defined by who the deal is waiting on, which is what makes it
 * actionable rather than decorative. Meaningful only while the status is
 * ONGOING; on close it freezes at whatever it was, and the interface reads it
 * in the past tense — "Lost, at Negotiation".
 */
export type OpportunityStage =
  | "REQUIREMENT_RECEIVED"
  | "SOLUTION_DESIGN"
  | "OEM_PRICING"
  | "QUOTATION_SUBMITTED"
  | "NEGOTIATION"
  | "AWAITING_DECISION"

export interface OpportunityLineSummary {
  id: string
  opportunityId: string
  product: string
  oemBrand: string | null
  model: string | null
  quantity: number | null
  /** Null means nobody has costed this line. Never render it as zero. */
  unitValue: string | null
  lineValue: string | null
  /** The profit as a percentage of `lineValue`, "-100.00" to "100.00". Null is "no margin yet". */
  marginPercent: string | null
  /** `lineValue` times `marginPercent`, worked out by the server. Null when either is missing — never "0.00". */
  marginAmount: string | null
  note: string | null
  order: number
  /** Who we will buy this product from. Optional while the deal is open,
      required on every line before it can be marked Won. */
  supplier: { id: string; name: string } | null
  createdAt: string
  updatedAt: string
}

export interface OpportunitySummary {
  id: string
  serial: string
  salesAccountId: string
  salesAccountName: string
  name: string
  track: SalesTrack
  /** Null means unpriced. The deal value, and the only figure that counts. */
  amount: string | null
  currency: string
  /** The deal's margin: its products' margins added up by the server. Null when no product carries one — never "0.00". */
  marginAmount: string | null
  /** Products whose margin cannot be worked out: no Total price, or no percentage. */
  unmarginedLineCount: number
  expectedCloseDate: string | null
  oemAccountManager: string | null
  status: OpportunityStatus
  statusReason: string | null
  closedAt: string | null
  stage: OpportunityStage
  stageChangedAt: string
  nextStep: string | null
  nextStepDueOn: string | null
  ownerEmployeeId: string
  ownerName: string
  wonByEmployeeId: string | null
  lastActivityAt: string
  createdAt: string
  updatedAt: string
  lines: OpportunityLineSummary[]
  /** Sum of the priced lines only. */
  lineTotal: string
  unpricedLineCount: number
  /**
   * True only when at least one line carries a value and the total differs
   * from the deal value. The interface says so and offers one button; it
   * never synchronises on its own.
   */
  amountDiffersFromLines: boolean
  /** Whether this viewer may change the deal. Decided by the server: the
      directory is shared, so seeing one and working it are different. */
  canManage: boolean
}

export interface OpportunityPage {
  items: OpportunitySummary[]
  nextCursor: string | null
}

export interface CreateOpportunityBody {
  salesAccountId: string
  name: string
  track: SalesTrack
  amount?: string
  expectedCloseDate?: string
  oemAccountManager?: string
  ownerEmployeeId?: string
  /** Adds the owner as a collaborator in the same action when they lack access. */
  addAssignment?: boolean
  /** The meeting it came out of, when made from that meeting's minutes. */
  meetingId?: string
}

export interface UpdateOpportunityBody {
  name?: string
  track?: SalesTrack
  amount?: string | null
  expectedCloseDate?: string | null
  oemAccountManager?: string | null
  ownerEmployeeId?: string
  addAssignment?: boolean
}

export interface OpportunityLineBody {
  product: string
  oemBrand?: string
  model?: string
  quantity?: number
  unitValue?: string
  lineValue?: string
  /** A percentage of the Total price, -100 to 100. Negative is a product sold at a loss. */
  marginPercent?: string
  note?: string
  /** Who we will buy this product from. Optional while the deal is open. */
  supplierId?: string | null
}

/** Null clears a value; absent leaves it alone. The two are different asks. */
export interface UpdateOpportunityLineBody {
  product?: string
  oemBrand?: string | null
  model?: string | null
  quantity?: number | null
  unitValue?: string | null
  lineValue?: string | null
  marginPercent?: string | null
  note?: string | null
  supplierId?: string | null
}

export type SalesCommentKind = "GENERAL" | "CUSTOMER_FEEDBACK" | "MANAGEMENT_NOTE"

export interface SalesCommentSummary {
  id: string
  entity: "SALES_ACCOUNT" | "OPPORTUNITY"
  entityId: string
  kind: SalesCommentKind
  body: string
  authorUserId: string
  authorEmployeeId: string | null
  authorName: string
  createdAt: string
  updatedAt: string
}

export interface SalesCommentPage {
  items: SalesCommentSummary[]
  /** More exist beyond `limit`. Say so; a capped list looks like a short one. */
  truncated: boolean
  limit: number
}

export interface CreateSalesCommentBody {
  entity: "SALES_ACCOUNT" | "OPPORTUNITY"
  entityId: string
  kind: SalesCommentKind
  body: string
}

/** Where a quarter sits against today. Only an ended quarter's shortfall is carried. */
export type SalesQuarterPhase = "ended" | "current" | "upcoming"

export interface SalesTargetQuarter {
  quarter: number
  phase: SalesQuarterPhase
  /** This quarter's equal part of the yearly target. */
  share: string | null
  /** Shortfall carried in from the quarter before; null when not known yet or not possible. */
  carried: string | null
  /** A carry may still arrive: the quarter before has not ended. */
  carryPending: boolean
  /** Share plus carried. Null means no target covers the quarter — a dash, never ৳0. */
  target: string | null
  valueWon: string
  dealsWon: number
  /** Wins with no price, left out of `valueWon` and named instead. */
  unpricedWonCount: number
  /** Target minus won: positive is short, negative is ahead. */
  gap: string | null
}

export interface SalesTargetYear {
  employeeId: string
  employeeName: string
  calendarYear: number
  /** Null means nobody set one. Render "Not set", never ৳0. */
  yearlyTarget: string | null
  startQuarter: number | null
  note: string | null
  valueWon: string
  dealsWon: number
  unpricedWonCount: number
  quarters: SalesTargetQuarter[]
}

/** A yearly amount of deal value in taka, split from `startQuarter` (1-4, Q1 when absent). */
export interface SetSalesTargetBody {
  employeeId: string
  calendarYear: number
  amount: string
  startQuarter?: number
  note?: string
}

/** The margin won on one account, from the products on its won deals. */
export interface SalesAccountMargin {
  value: string
  /** Products in the sum. */
  counted: number
  /** Products with no Total price or no percentage, left out and named. */
  missing: number
  /** Won deals with no products at all, whose margin cannot be known. */
  dealsWithoutProducts: number
}

export interface SalesActionRow {
  key: string
  label: string
  count: number
  detail: string
  tone: Tone
  /** Role-agnostic. The client prefixes `/sales`. */
  href: string
}

export interface SalesTeamRow {
  employeeId: string
  employeeName: string
  /** This quarter's target in taka, carry included. Null means none set. */
  target: string | null
  valueWon: string
  dealsWon: number
  ongoing: number
}

export interface SalesDashboardPayload {
  scope: "me" | "employee" | "all"
  employeeId: string | null
  employeeName: string
  calendarYear: number
  quarter: number
  stats: DashboardStat[]
  quarters: SalesTargetQuarter[]
  actions: SalesActionRow[]
  team?: SalesTeamRow[]
  badges: Record<string, number>
  /**
   * What this page cannot show yet. Rendered as a sentence, because an empty
   * "Tasks due" row would read as "no tasks" — a number nobody measured.
   */
  notBuilt: string[]
}

// ── Meetings and tasks (phase 3, revision §24) ──────────────────────────────

export type SalesMeetingMode = "CUSTOMER_SITE" | "OUR_OFFICE" | "ONLINE"
export type SalesMeetingStatus = "SCHEDULED" | "COMPLETED" | "CANCELLED"

export interface SalesMeetingAttendeeSummary {
  id: string
  side: "OURS" | "THEIRS"
  employeeId: string | null
  contactId: string | null
  /** From the employee or contact record when there is one, else as typed. */
  name: string
  designation: string | null
}

export interface SalesMeetingSummary {
  id: string
  salesAccountId: string
  salesAccountName: string
  opportunityId: string | null
  opportunitySerial: string | null
  opportunityName: string | null
  title: string
  mode: SalesMeetingMode
  scheduledAt: string
  endsAt: string | null
  location: string | null
  notes: string | null
  status: SalesMeetingStatus
  cancelReason: string | null
  outcome: string | null
  completedAt: string | null
  attendees: SalesMeetingAttendeeSummary[]
  /** The meeting's minutes once started (phase 4). Everyone who can see the
      meeting sees this much; what the minutes say is for the people who work
      the account (revision §25.27). */
  minutes: { id: string; status: SalesMinutesStatus; lastSentAt: string | null } | null
  /** Whether the viewer works the account, and so may change the meeting. */
  canManage: boolean
}

// ── Meeting minutes (phase 4, revision §25) ─────────────────────────────────

export type SalesMinutesStatus = "DRAFT" | "SENT" | "EDITED_AFTER_SENDING"
/** What a section holds (§25.18). The Next Steps table's columns are fixed. */
export type MinutesKind = "PARAGRAPHS" | "BULLETS" | "SUBTOPICS" | "TABLE" | "RICH"

/**
 * Formatted text (the owner's change, 2026-09-15): the Word-style toolbar's
 * document, as Tiptap saves it. The server checks every node and mark against
 * a fixed list; the client only needs its shape.
 */
export interface RichNode {
  type: string
  attrs?: Record<string, unknown>
  content?: RichNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

export interface RichDoc {
  type: "doc"
  content: RichNode[]
}

/** A bullet and the second level under it; the documents go no deeper. */
export interface MinutesBullet {
  text: string
  sub: string[]
}

export interface MinutesTopic {
  title: string
  text: string
  bullets: MinutesBullet[]
}

/** A Next Steps row. `taskId` is the task it made, which the server alone sets. */
export interface MinutesTableRow {
  actionItem: string
  responsible: string
  status: string
  taskId: string | null
}

export type MinutesSection =
  | { heading: string; kind: "PARAGRAPHS"; content: { paragraphs: string[] } }
  | { heading: string; kind: "BULLETS"; content: { bullets: MinutesBullet[] } }
  | { heading: string; kind: "SUBTOPICS"; content: { topics: MinutesTopic[] } }
  | { heading: string; kind: "TABLE"; content: { rows: MinutesTableRow[] } }
  | { heading: string; kind: "RICH"; content: RichDoc }

export interface SalesMinutesDetail {
  id: string
  meetingId: string
  status: SalesMinutesStatus
  lastSentAt: string | null
  purpose: string | null
  meetingWithNote: string | null
  requirementFound: boolean | null
  /** The meeting has no deal, so the requirement question is asked. */
  asksRequirement: boolean
  /** Sent at least once, so the answer no longer changes. */
  requirementLocked: boolean
  /** "Meeting Minutes – APS Group". */
  title: string
  subtitle: string
  /** The header's labelled lines, exactly as the PDF prints them. */
  header: { label: string; value: string }[]
  fileName: string
  companyName: string
  meeting: {
    id: string
    title: string
    scheduledAt: string
    endsAt: string | null
    status: SalesMeetingStatus
    salesAccountId: string
    salesAccountName: string
    opportunityId: string | null
    opportunitySerial: string | null
    opportunityName: string | null
  }
  attendees: { side: "OURS" | "THEIRS"; name: string; designation: string | null }[]
  sections: MinutesSection[]
  preparers: { employeeId: string; name: string; title: string | null; titleExtra: string | null }[]
  /** Every copy downloaded for sending, newest first, each kept exactly as it went out. */
  sends: { id: string; sentAt: string; sentByName: string | null; sentTo: string | null; fileName: string }[]
  /** One line per save and per send, newest first. */
  history: { id: string; at: string; byName: string | null; text: string }[]
  /** Deals made from this meeting. */
  originatedDeals: { id: string; serial: string; name: string }[]
  /** Only before the first send. */
  canDelete: boolean
}

export interface SalesMinutesListItem {
  id: string
  meetingId: string
  meetingTitle: string
  scheduledAt: string
  salesAccountId: string
  salesAccountName: string
  preparedBy: string[]
  status: SalesMinutesStatus
  lastSentAt: string | null
}

/** A Next Steps row as Save sends it: `newTask` is the tick, sent once. */
export interface MinutesTableRowBody extends MinutesTableRow {
  newTask?: { dueOn: string }
}

export type MinutesSectionBody =
  | Exclude<MinutesSection, { kind: "TABLE" }>
  | { heading: string; kind: "TABLE"; content: { rows: MinutesTableRowBody[] } }

export interface SaveMinutesBody {
  purpose: string | null
  meetingWithNote: string | null
  sections: MinutesSectionBody[]
  preparers: { employeeId: string; titleExtra: string | null }[]
}

export interface MinutesTemplateSection {
  heading: string
  kind: MinutesKind
  /** New minutes put the meeting's outcome note here. One section at most, of paragraphs. */
  startsWithOutcome?: boolean
}

export interface MinutesTemplate {
  sections: MinutesTemplateSection[]
  isDefault: boolean
  updatedAt: string | null
}

export interface MeetingAttendeeBody {
  side: "OURS" | "THEIRS"
  employeeId?: string
  contactId?: string
  name?: string
  designation?: string
}

export interface CreateMeetingBody {
  salesAccountId: string
  opportunityId?: string
  title: string
  mode?: SalesMeetingMode
  scheduledAt: string
  endsAt?: string
  location?: string
  notes?: string
  attendees?: MeetingAttendeeBody[]
}

/** Absent leaves a field alone; null clears it. The attendee list, when sent, replaces the old one. */
export interface UpdateMeetingBody {
  opportunityId?: string | null
  title?: string
  mode?: SalesMeetingMode
  scheduledAt?: string
  endsAt?: string | null
  location?: string | null
  notes?: string | null
  attendees?: MeetingAttendeeBody[]
}

export type ChangeMeetingStatusBody =
  | { status: "COMPLETED"; outcome?: string }
  | { status: "CANCELLED"; reason: string }
  | { status: "SCHEDULED" }

export interface ListMeetingsQuery {
  salesAccountId?: string
  opportunityId?: string
  status?: SalesMeetingStatus
  mine?: boolean
  from?: string
  to?: string
}

export type SalesTaskStatus = "PENDING" | "DONE" | "CANCELLED"
export type SalesTaskPriority = "LOW" | "NORMAL" | "HIGH"
export type SalesTaskOrigin = "SELF" | "FUNNEL_MEETING"
/** overdue: before today. today. now: today or overdue. week: today and the six days after. */
export type TaskDueFilter = "overdue" | "today" | "now" | "week"

export interface SalesTaskSummary {
  id: string
  origin: SalesTaskOrigin
  salesAccountId: string | null
  salesAccountName: string | null
  opportunityId: string | null
  opportunitySerial: string | null
  opportunityName: string | null
  meetingId: string | null
  meetingTitle: string | null
  title: string
  detail: string | null
  /** YYYY-MM-DD. */
  dueOn: string
  priority: SalesTaskPriority
  assignedToEmployeeId: string
  assignedToName: string
  status: SalesTaskStatus
  outcome: string | null
  cancelReason: string | null
  completedAt: string | null
  /** Pending and due before today. Worked out by the server. */
  overdue: boolean
  /** Only the owner changes a task, a Sales Admin included. */
  canManage: boolean
  createdAt: string
}

export interface SalesTaskStatusResult extends SalesTaskSummary {
  /** After Done, the date to offer for the next follow-up. Null otherwise. */
  nextFollowUpOn: string | null
}

export interface CreateTaskBody {
  salesAccountId: string
  opportunityId?: string
  meetingId?: string
  title: string
  detail?: string
  dueOn: string
  priority?: SalesTaskPriority
}

export interface UpdateTaskBody {
  opportunityId?: string | null
  meetingId?: string | null
  title?: string
  detail?: string | null
  dueOn?: string
  priority?: SalesTaskPriority
}

export type ChangeTaskStatusBody =
  | { status: "DONE"; outcome?: string }
  | { status: "CANCELLED"; reason: string }
  | { status: "PENDING" }

export interface ListTasksQuery {
  status?: SalesTaskStatus
  due?: TaskDueFilter
  origin?: SalesTaskOrigin
  salesAccountId?: string
  opportunityId?: string
  meetingId?: string
  mine?: boolean
}

/**
 * Editing an account. Absent leaves a field alone; null clears it. The two
 * are different asks, and without the distinction a website typed once can
 * never be removed.
 */
export interface UpdateSalesAccountBody {
  name?: string
  ownerEmployeeId?: string
  industry?: string | null
  website?: string | null
  address?: string | null
  status?: SalesAccountStatus
  /** Required by the server whenever the status leaves ACTIVE. */
  statusReason?: string | null
}

// ── the weekly report (phase 5, revision §26) ────────────────────────────────

export type WeeklyReportStatus = "NOT_STARTED" | "DRAFT" | "SUBMITTED"

/** Why a day is empty, when that is not the person's doing (§26.12). */
export interface WeeklyDayLabel {
  kind: "HOLIDAY" | "WEEKLY_OFF" | "LEAVE" | "OUTSIDE_EMPLOYMENT"
  text: string
}

export interface WeeklyRowDeal {
  id: string
  serial: string
  name: string
  /** The products, or the deal's name when it has none yet. */
  requirement: string
  softwareNeeded: boolean | null
  nextStep: string | null
}

/** One account on one day: the row the team's own sheets have (§26.7). */
export interface WeeklyAccountRow {
  salesAccountId: string
  accountName: string
  deals: WeeklyRowDeal[]
  requirement: string
  visited: string[]
  pendingTasks: { id: string; title: string; dueOn: string }[]
  challenges: string | null
  gap: string | null
  /** Typed, and only where the account has no open deal. */
  nextStep: string | null
  taskId: string | null
}

export interface WeeklyOtherWork {
  id: string
  date: string
  text: string
}

export interface WeeklyDay {
  date: string
  label: WeeklyDayLabel | null
  accounts: WeeklyAccountRow[]
  otherWork: WeeklyOtherWork[]
}

export interface WeeklyCounts {
  accounts: number
  communications: number
  meetings: number
  dealChanges: number
  tasksDone: number
}

export interface WeeklyReportDetail {
  weekStart: string
  days: WeeklyDay[]
  counts: WeeklyCounts
  status: WeeklyReportStatus
  /** The day it is due: the Thursday, or the last working day before it. */
  deadlineDay: string
  submittedLate: boolean
  firstSubmittedAt: string | null
  lastSubmittedAt: string | null
  copies: { id: string; submittedAt: string; fileName: string }[]
  person: { employeeId: string; fullName: string; designation: string }
}

/** One line of All Reports (§26.15). */
export interface WeeklyTeamRow {
  employeeId: string
  fullName: string
  designation: string
  status: WeeklyReportStatus
  submittedLate: boolean
  firstSubmittedAt: string | null
}

export interface SaveWeeklyNoteBody {
  date: string
  salesAccountId: string
  challenges: string | null
  gap: string | null
  nextStep: string | null
  /** Turns the typed next step into a task for me, due a week out (§26.10). */
  makeTask: boolean
}

export interface AddWeeklyOtherWorkBody {
  date: string
  text: string
}

// ── the funnel (revision §27) ───────────────────────────────────────────────
// Hand-mirrored from the server's `funnel/funnel.types.ts`, as everything in
// this file is. Keep the two in step by hand; there is no shared package.

/** Who took a deal we lost, and with what (§27.4). */
export interface FunnelLostTo {
  partner: string | null
  amount: string | null
  product: string | null
}

/** One remark: the deal's own comment, not a funnel field (§27.8). */
export interface FunnelRemark {
  id: string
  kind: SalesCommentKind
  body: string
  authorName: string
  createdAt: string
  funnelMeetingId: string | null
}

/** One product line of a deal, for the row detail (§27.6). */
export interface FunnelLine {
  product: string
  brand: string | null
  model: string | null
  quantity: number | null
}

/** One line of the grid, in the sheet's fifteen columns (§27.6). */
export interface FunnelRow {
  /** Screen position, not an identity — it renumbers on filter and sort. */
  serialNo: number
  opportunityId: string
  serial: string
  offeredOn: string | null
  salesAccountId: string
  accountName: string
  /** Headed "Project Name" in the grid. There is no Project table (§27.6). */
  projectName: string
  useCase: string | null
  brand: string
  model: string
  quantity: string
  lineCount: number
  /** Every line, in order — what "+N more" points at. */
  lines: FunnelLine[]
  amount: string | null
  status: OpportunityStatus
  stage: OpportunityStage
  closingDate: string | null
  /** "Oct 2026", or empty. Never a day number (§27.6). */
  closingDateLabel: string
  /** Derived from the audit log, stored nowhere (§27.15). */
  closingDateSlipped: boolean
  previousClosingDate: string | null
  lostTo: FunnelLostTo
  nextStep: string | null
  /** Composed per read and never stored (§27.8). */
  offerLine: string | null
  remarks: FunnelRemark[]
}

/** Two labelled figures, never one (§27.10). */
export interface FunnelTotals {
  /** Null when nothing in view is priced: zero would be a claim (§27.10). */
  quoted: string | null
  quotedCount: number
  /** Null on the same terms. */
  stillOpen: string | null
  stillOpenCount: number
  /** Deals carrying no amount. In neither figure, and said out loud. */
  unpricedCount: number
}

export interface FunnelGrid {
  employeeId: string
  employeeName: string
  rows: FunnelRow[]
  /**
   * True when the view holds more deals than `rows` shows. The totals still
   * cover every deal in view, so the two can differ and the screen says so.
   */
  truncated: boolean
  totals: FunnelTotals
}

export interface FunnelTeamRow {
  employeeId: string
  employeeName: string
  dealCount: number
  /** Null when the person has no priced deals. Never rendered as zero. */
  quoted: string | null
  stillOpen: string | null
  reviewed: boolean
}

export interface FunnelTeam {
  /** The Sunday of the week under review. */
  weekStart: string
  rows: FunnelTeamRow[]
}

export type FunnelSort = "offeredOn" | "status" | "amount" | "expectedCloseDate" | "account"

export interface FunnelQueryOptions {
  employeeId?: string
  status?: OpportunityStatus
  salesAccountId?: string
  hideClosed?: boolean
  changedLastWeek?: boolean
  sort?: FunnelSort
  direction?: "asc" | "desc"
}

/**
 * The cells the grid may write. Status is not among them: changing it has its
 * own rules and lives on the deal page (§27.7).
 */
export type FunnelCellField =
  | "useCase"
  | "offeredOn"
  | "expectedCloseDate"
  | "amount"
  | "nextStep"
  | "lostToPartner"
  | "lostToAmount"
  | "lostToProduct"

export interface FunnelCellEdit {
  field: FunnelCellField
  value: string | null
}

export interface FunnelMeetingDetail {
  id: string
  weekStart: string
  heldOn: string
  status: "SCHEDULED" | "COMPLETED"
  ranByEmployeeId: string
  ranByName: string
  note: string | null
  attendees: { employeeId: string; employeeName: string }[]
  /** Kept apart from attendance on purpose (§27.3). */
  reviewed: { employeeId: string; employeeName: string; reviewedAt: string }[]
  actionItemCount: number
}

export interface FunnelActionBody {
  assignedToEmployeeId: string
  title: string
  detail?: string | null
  /** Defaults to next Saturday when absent (§27.13). */
  dueOn?: string
  priority?: "LOW" | "NORMAL" | "HIGH"
  salesAccountId?: string | null
  opportunityId?: string | null
}
