// `export *` at the foot of this file re-exports payroll-types but does not
// bring its names into local scope, so Employee's structure ref imports it.
import type { Currency } from "./payroll-types"

// Hand-mirrored from server/src/generated/prisma's Role enum. No shared
// types package (client and server are separate projects) — if the
// server's Role enum changes, update this by hand.
export type Role = "SUPER_ADMIN" | "HR_ADMIN" | "FINANCE_OFFICER" | "REPORTING_MANAGER" | "EMPLOYEE"
export interface PostingRule { id: string; event: string; key: string; accountId: string; note: string | null; account: { code: string; name: string } }
export interface UnresolvedKey { event: string; key: string }

export interface PublicUser {
  id: string
  email: string
  role: Role
  isActive: boolean
  mustChangePassword: boolean
  employeeCode?: string
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
