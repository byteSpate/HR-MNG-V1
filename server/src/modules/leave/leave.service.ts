import prisma from "../../config/prisma"
import type { Employee, LeaveType } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { assertMonthNotLocked } from "../../utils/month-lock"
import { resolveShift } from "../attendance/attendance.grid"
import { recomputePunchFlags } from "../attendance/attendance.recompute"
import { shiftMidpoint } from "../attendance/attendance.time"
import type { AccessTokenPayload } from "../auth/auth.types"
import { emitEvent } from "../event/event.emit"
import {
  sendLeaveDecidedEmail,
  sendLeaveRequestedEmail,
} from "../notification/notification.mailer"
import { recipientsForLeaveRequest } from "../notification/notification.recipients"
import { visibilityTierFor } from "../employee/employee.access"
import { employeeIdForUser } from "../employee/employee.service"
import {
  computeEarnedAccrual,
  completedServiceMonths,
  type AccrualEmployee,
  type EarnedAccrual,
} from "./leave.accrual"
import {
  loadCalendarForYear,
  loadCalendarSpanning,
  loadLeaveCalendar,
} from "./leave.calendar"
import {
  addDays,
  calendarSpan,
  countChargedDays,
  formatDateOnly,
  isHalfDay,
  MAX_BACKDATE_DAYS,
  parseDateOnly,
  todayUtc,
  WHOLE_DAY,
  type LeaveCalendar,
  type LeaveSessions,
} from "./leave.dates"
import { leaveEvent } from "./leave.events"
import { EARNED_LEAVE_DAYS_PER_DAY } from "./leave.policy"
import type {
  AccrualDetail,
  ApplyLeaveInput,
  DecidedBy,
  LeaveBalanceItem,
  LeaveRequestItem,
  LeaveTypeItem,
  TeamMemberStatus,
  TeamStatus,
} from "./leave.types"

/** Everything the balance maths needs about an employee. */
export type BalanceEmployee = Pick<Employee, "employmentType"> & AccrualEmployee

/** The policy fields that decide how a type is counted and entitled. */
type PolicyType = Pick<
  LeaveType,
  "annualQuota" | "accrualBasis" | "minServiceMonths" | "maxAccrual" | "countsHolidays"
>

/**
 * Annual entitlement, pro-rated across the joining year. A November hire
 * shouldn't receive a full year's quota on their first day.
 */
export function computeEntitlement(annualQuota: number, joiningDate: Date, year: number): number {
  const joinYear = joiningDate.getUTCFullYear()
  if (joinYear > year) return 0
  if (joinYear < year) return annualQuota
  const monthsRemaining = 12 - joiningDate.getUTCMonth()
  return Math.max(0, Math.round((annualQuota * monthsRemaining) / 12))
}

/**
 * Entitlement for one type in one year, dispatched on its accrual basis.
 *
 * `accrual` is passed in rather than computed here because deriving it costs
 * a day-grid build over twelve months — worth doing once per employee, not
 * once per leave type.
 */
export function entitlementFor(
  leaveType: PolicyType,
  employee: Pick<Employee, "joiningDate">,
  year: number,
  accrual: EarnedAccrual | null
): number {
  switch (leaveType.accrualBasis) {
    case "NONE":
      return 0
    // Per occasion, never pro-rated: a §46 maternity benefit is not smaller
    // because the employee joined in October.
    case "PER_EVENT":
      return leaveType.annualQuota
    case "EARNED":
      return accrual?.days ?? 0
    default:
      return computeEntitlement(leaveType.annualQuota, employee.joiningDate, year)
  }
}

/**
 * Unpaid leave is modelled as a zero-quota unpaid type rather than a schema
 * flag — these skip balance checks entirely, so an employee whose annual
 * allowance is spent still has a way to take time off.
 */
export function isUnpaidType(leaveType: { isPaid: boolean; annualQuota: number }): boolean {
  return !leaveType.isPaid && leaveType.annualQuota === 0
}

/**
 * Where to measure accrual from for a given leave year: today, or the end of
 * that year if it is already over. Asking for 2025's balance in 2026 must not
 * keep accruing 2026's work into it.
 */
function accrualAsOf(year: number): Date {
  const today = todayUtc()
  const yearEnd = new Date(Date.UTC(year, 11, 31))
  return today.getTime() < yearEnd.getTime() ? today : yearEnd
}

const toAccrualDetail = (accrual: EarnedAccrual, minServiceMonths: number): AccrualDetail => ({
  daysWorked: accrual.daysWorked,
  perDaysWorked: EARNED_LEAVE_DAYS_PER_DAY,
  windowStart: accrual.windowStart,
  windowEnd: accrual.windowEnd,
  untrackedDays: accrual.untrackedDays,
  eligible: accrual.eligible,
  minServiceMonths,
})

export async function getBalancesForEmployee(
  employee: BalanceEmployee,
  year: number
): Promise<LeaveBalanceItem[]> {
  const [leaveTypes, requests, calendar] = await Promise.all([
    prisma.leaveType.findMany({ orderBy: { name: "asc" } }),
    prisma.leaveRequest.findMany({
      where: {
        employeeId: employee.id,
        status: { in: ["PENDING", "APPROVED"] },
        startDate: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lte: new Date(Date.UTC(year, 11, 31)),
        },
      },
      select: {
        leaveTypeId: true,
        status: true,
        startDate: true,
        endDate: true,
        startSession: true,
        endSession: true,
      },
    }),
    loadCalendarForYear(year),
  ])

  const eligible = leaveTypes.filter((lt) => lt.eligibleFor.includes(employee.employmentType))

  // At most one day-grid build, and only when an accrual type is actually on
  // offer — every other type answers from the quota alone.
  const earnedType = eligible.find((lt) => lt.accrualBasis === "EARNED")
  const accrual = earnedType
    ? await computeEarnedAccrual(employee, accrualAsOf(year), {
        minServiceMonths: earnedType.minServiceMonths,
        maxAccrual: earnedType.maxAccrual,
      })
    : null

  return eligible.map((lt) => {
    const mine = requests.filter((r) => r.leaveTypeId === lt.id)
    const sum = (status: string) =>
      mine
        .filter((r) => r.status === status)
        .reduce(
          (total, r) =>
            total +
            // `r` carries startSession/endSession, so it satisfies
            // LeaveSessions structurally and is passed straight through.
            countChargedDays(r.startDate, r.endDate, r, {
              countsHolidays: lt.countsHolidays,
              calendar,
            }),
          0
        )

    const used = sum("APPROVED")
    const pending = sum("PENDING")
    const entitlement = entitlementFor(lt, employee, year, accrual)

    return {
      leaveTypeId: lt.id,
      code: lt.code,
      name: lt.name,
      isPaid: lt.isPaid,
      annualQuota: lt.annualQuota,
      entitlement,
      used,
      pending,
      balance: entitlement - used - pending,
      accrual:
        lt.accrualBasis === "EARNED" && accrual
          ? toAccrualDetail(accrual, lt.minServiceMonths)
          : null,
    }
  })
}

export async function listLeaveTypes(): Promise<LeaveTypeItem[]> {
  const types = await prisma.leaveType.findMany({ orderBy: { name: "asc" } })
  return types.map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    isPaid: t.isPaid,
    annualQuota: t.annualQuota,
    carryForwardPct: t.carryForwardPct,
    maxConsecutive: t.maxConsecutive,
    allowsBackdating: t.allowsBackdating,
    eligibleFor: t.eligibleFor,
    statutory: t.statutory,
    countsHolidays: t.countsHolidays,
    accrualBasis: t.accrualBasis,
    minServiceMonths: t.minServiceMonths,
    maxAccrual: t.maxAccrual,
    allowsHalfDay: t.allowsHalfDay,
  }))
}

/** Resolves the caller's Employee row, or explains why they don't have one. */
export async function requireEmployeeForUser(userId: string) {
  const employee = await prisma.employee.findUnique({ where: { userId } })
  if (!employee) {
    throw new AppError(403, "This account has no employee profile, so it cannot hold leave")
  }
  return employee
}

/**
 * The shift window a half day is measured against, for one date.
 *
 * Per date rather than per employee: a dated shift override (Ramadan hours)
 * moves the midpoint, so a window resolved once at login would be wrong for a
 * leave filed into that window.
 *
 * Null when no shift resolves — a half day is meaningless without one, and
 * the dialog disables the option rather than defaulting to a shift the
 * employee is not on.
 */
export async function getHalfDayWindow(
  userId: string,
  date: string
): Promise<{ startTime: string; midpoint: string; endTime: string } | null> {
  const employee = await requireEmployeeForUser(userId)
  const shifts = await prisma.shift.findMany()
  if (shifts.length === 0) return null

  const shift = resolveShift(employee, parseDateOnly(date), shifts)
  return {
    startTime: shift.startTime,
    midpoint: shiftMidpoint(shift),
    endTime: shift.endTime,
  }
}

export async function getMyBalances(userId: string): Promise<LeaveBalanceItem[]> {
  const employee = await requireEmployeeForUser(userId)
  return getBalancesForEmployee(employee, new Date().getUTCFullYear())
}

/**
 * Somebody else's balances, for the manager view on the employee detail page.
 *
 * The authorisation is the same relationship `visibilityTierFor` already
 * computes, imported rather than restated — a second copy of "is this my
 * direct report" is a second copy that can disagree.
 *
 * FINANCE is deliberately excluded even though it is an elevated tier: leave
 * balances are people data, and Finance's tier exists for money.
 */
export async function getBalancesFor(
  viewer: AccessTokenPayload,
  employeeId: string
): Promise<LeaveBalanceItem[]> {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } })
  if (!employee) throw new AppError(404, "Employee not found")

  const tier = visibilityTierFor(viewer, employee, await employeeIdForUser(viewer.sub))
  if (tier !== "FULL" && tier !== "MANAGER" && tier !== "SELF") {
    throw new AppError(403, "You do not have access to this employee's leave balances")
  }
  return getBalancesForEmployee(employee, new Date().getUTCFullYear())
}

// `countsHolidays` is selected but not returned: `days` is server-computed,
// so the client never needs to know how a stored request was charged — only
// how a type it is about to file against will be.
const REQUEST_INCLUDE = {
  employee: { select: { id: true, fullName: true, employeeCode: true } },
  leaveType: { select: { id: true, code: true, name: true, isPaid: true, countsHolidays: true } },
} as const

type IncludedRequest = {
  startDate: Date
  endDate: Date
  startSession: LeaveSessions["startSession"]
  endSession: LeaveSessions["endSession"]
  leaveType: { id: string; code: string; name: string; isPaid: boolean; countsHolidays: boolean }
}

/** Charged days for a stored request, honouring its own type's holiday rule. */
function chargedDays(request: IncludedRequest, calendar: LeaveCalendar): number {
  return countChargedDays(request.startDate, request.endDate, request, {
    countsHolidays: request.leaveType.countsHolidays,
    calendar,
  })
}

const toLeaveTypeRef = (leaveType: IncludedRequest["leaveType"]) => ({
  id: leaveType.id,
  code: leaveType.code,
  name: leaveType.name,
  isPaid: leaveType.isPaid,
})

/**
 * `approvedBy` holds a user id. Resolve it to something displayable — a raw
 * UUID in an "Approver" column is useless. HR/Finance/Admin users have no
 * Employee row, so fullName is null for them and the UI falls back to email.
 */
async function resolveDeciders(userIds: string[]) {
  const unique = [...new Set(userIds)]
  if (unique.length === 0) return new Map<string, DecidedBy>()
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, email: true, employee: { select: { fullName: true } } },
  })
  return new Map<string, DecidedBy>(
    users.map((u) => [u.id, { id: u.id, email: u.email, fullName: u.employee?.fullName ?? null }])
  )
}

export async function listLeaveRequests(actor: AccessTokenPayload): Promise<LeaveRequestItem[]> {
  let where: Record<string, unknown> = {}

  if (actor.role === "EMPLOYEE") {
    const self = await requireEmployeeForUser(actor.sub)
    where = { employeeId: self.id }
  } else if (actor.role === "REPORTING_MANAGER") {
    const self = await requireEmployeeForUser(actor.sub)
    where = { OR: [{ employeeId: self.id }, { employee: { reportingManagerId: self.id } }] }
  }
  // HR_ADMIN / SUPER_ADMIN / FINANCE_OFFICER see everything.

  const requests = await prisma.leaveRequest.findMany({
    where,
    include: REQUEST_INCLUDE,
    orderBy: { createdAt: "desc" },
  })

  const [deciders, calendar] = await Promise.all([
    resolveDeciders(requests.map((r) => r.approvedBy).filter((id): id is string => !!id)),
    // One holiday query spanning every request on the page, not one per row.
    loadCalendarSpanning(requests),
  ])

  return requests.map((r) => ({
    id: r.id,
    employee: r.employee,
    leaveType: toLeaveTypeRef(r.leaveType),
    startDate: formatDateOnly(r.startDate),
    endDate: formatDateOnly(r.endDate),
    startSession: r.startSession,
    endSession: r.endSession,
    days: chargedDays(r, calendar),
    reason: r.reason,
    status: r.status,
    decidedBy: r.approvedBy ? (deciders.get(r.approvedBy) ?? null) : null,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt.toISOString(),
  }))
}

export async function getTeamStatus(userId: string): Promise<TeamMemberStatus[]> {
  const manager = await requireEmployeeForUser(userId)
  const today = todayUtc()

  const reports = await prisma.employee.findMany({
    where: { reportingManagerId: manager.id },
    orderBy: { fullName: "asc" },
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      designation: true,
      employmentStatus: true,
      leaveRequests: {
        where: { status: "APPROVED", startDate: { lte: today }, endDate: { gte: today } },
        select: { startDate: true, endDate: true, leaveType: { select: { name: true } } },
        take: 1,
      },
    },
  })

  return reports.map((r) => {
    const active = r.leaveRequests[0]
    // Precedence: left > on leave > active. A pending request is deliberately
    // not a status — applying says nothing about where someone is today.
    let status: TeamStatus = "ACTIVE"
    if (r.employmentStatus === "RESIGNED" || r.employmentStatus === "TERMINATED") {
      status = "LEFT"
    } else if (active) {
      status = "ON_LEAVE"
    }

    return {
      id: r.id,
      fullName: r.fullName,
      employeeCode: r.employeeCode,
      designation: r.designation,
      status,
      currentLeave:
        status === "ON_LEAVE" && active
          ? {
              leaveTypeName: active.leaveType.name,
              startDate: formatDateOnly(active.startDate),
              endDate: formatDateOnly(active.endDate),
            }
          : null,
    }
  })
}

export async function applyForLeave(
  userId: string,
  input: ApplyLeaveInput
): Promise<LeaveRequestItem> {
  const employee = await requireEmployeeForUser(userId)

  let start: Date
  let end: Date
  try {
    start = parseDateOnly(input.startDate)
    end = parseDateOnly(input.endDate)
  } catch (err) {
    throw new AppError(400, (err as Error).message)
  }

  // 1. Ordering
  if (end.getTime() < start.getTime()) {
    throw new AppError(400, "The end date cannot be before the start date")
  }

  // 2. Single leave year — a range crossing Dec 31 makes the balance ambiguous
  if (start.getUTCFullYear() !== end.getUTCFullYear()) {
    throw new AppError(
      400,
      "A request cannot span two years. Please split it into one request per year."
    )
  }

  const leaveType = await prisma.leaveType.findUnique({ where: { id: input.leaveTypeId } })
  if (!leaveType) {
    throw new AppError(400, "That leave type no longer exists")
  }

  // Half days are company policy on top of the Act, gated per type: a §46
  // maternity benefit is not taken in halves.
  const sessions: LeaveSessions = {
    startSession: input.startSession ?? WHOLE_DAY.startSession,
    endSession: input.endSession ?? WHOLE_DAY.endSession,
  }
  if (isHalfDay(sessions) && !leaveType.allowsHalfDay) {
    throw new AppError(400, `${leaveType.name} leave cannot be taken as a half day`)
  }

  // 3. Backdating
  const today = todayUtc()
  if (start.getTime() < today.getTime()) {
    if (!leaveType.allowsBackdating) {
      throw new AppError(400, `${leaveType.name} leave cannot start in the past`)
    }
    if (start.getTime() < addDays(today, -MAX_BACKDATE_DAYS).getTime()) {
      throw new AppError(400, `Backdated leave cannot start more than ${MAX_BACKDATE_DAYS} days ago`)
    }
  }

  // 4. Continuous service. Earned leave needs a year of it (§117), maternity
  // six months (§45) — measured at the leave start, not at filing, so a
  // request that becomes valid before it begins is not refused today.
  if (leaveType.minServiceMonths > 0) {
    const served = completedServiceMonths(employee.joiningDate, start)
    if (served < leaveType.minServiceMonths) {
      throw new AppError(
        400,
        `${leaveType.name} leave needs ${leaveType.minServiceMonths} months of continuous service. You will have completed ${served} by ${input.startDate}.`
      )
    }
  }

  // 5. Must charge at least one day
  const calendar = await loadLeaveCalendar(start, end)
  const days = countChargedDays(start, end, sessions, {
    countsHolidays: leaveType.countsHolidays,
    calendar,
  })
  if (days < 0.5) {
    throw new AppError(
      400,
      "That range is entirely weekly holidays and public holidays, so there is nothing to charge"
    )
  }

  // 6. Overlap with anything already live
  const clash = await prisma.leaveRequest.findFirst({
    where: {
      employeeId: employee.id,
      status: { in: ["PENDING", "APPROVED"] },
      startDate: { lte: end },
      endDate: { gte: start },
    },
  })
  if (clash) {
    throw new AppError(400, "You already have a pending or approved request overlapping those dates")
  }

  // 7. Eligibility
  if (!leaveType.eligibleFor.includes(employee.employmentType)) {
    throw new AppError(
      400,
      `${employee.employmentType} employees are not eligible for ${leaveType.name} leave`
    )
  }

  // 8. Max consecutive absence — measured in calendar days, because the policy
  // caps how long someone is away, not how much balance they burn.
  if (leaveType.maxConsecutive !== null && calendarSpan(start, end) > leaveType.maxConsecutive) {
    throw new AppError(
      400,
      `${leaveType.name} leave is limited to ${leaveType.maxConsecutive} consecutive days`
    )
  }

  // 9. Balance — pending counts here so requests can't be stacked past quota
  if (!isUnpaidType(leaveType)) {
    const balances = await getBalancesForEmployee(employee, start.getUTCFullYear())
    const balance = balances.find((b) => b.leaveTypeId === leaveType.id)
    if (!balance || balance.balance < days) {
      throw new AppError(
        400,
        `That request needs ${days} day(s) but only ${balance?.balance ?? 0} remain. Consider applying for Leave Without Pay instead.`
      )
    }
  }

  // The request and its event commit together. An event that survives a
  // rolled-back create would tell a manager to review something that does
  // not exist.
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.leaveRequest.create({
      data: {
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        startDate: start,
        endDate: end,
        startSession: sessions.startSession,
        endSession: sessions.endSession,
        reason: input.reason ?? null,
        status: "PENDING",
      },
      include: REQUEST_INCLUDE,
    })

    await emitEvent(tx, {
      ...leaveEvent({
        type: "leave.requested",
        verb: "requested",
        actorUserId: userId,
        request: row,
        leaveType,
        employee: { id: employee.id, fullName: row.employee.fullName },
        days,
      }),
    })

    return row
  })

  // After the transaction, never inside it: an SMTP round trip must not hold
  // a database transaction open. Fire-and-forget by construction — the
  // builder uses `notify`, so a dead mail server cannot fail the request.
  const recipients = await recipientsForLeaveRequest(employee.id)
  await Promise.all(
    recipients.map((to) =>
      sendLeaveRequestedEmail({
        to,
        requestId: created.id,
        employeeName: created.employee.fullName,
        leaveType: leaveType.name,
        startDate: formatDateOnly(created.startDate),
        endDate: formatDateOnly(created.endDate),
        days: String(days),
      })
    )
  )

  return {
    id: created.id,
    employee: created.employee,
    leaveType: toLeaveTypeRef(created.leaveType),
    startDate: formatDateOnly(created.startDate),
    endDate: formatDateOnly(created.endDate),
    startSession: created.startSession,
    endSession: created.endSession,
    days,
    reason: created.reason,
    status: created.status,
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: created.createdAt.toISOString(),
  }
}

async function loadRequestOr404(id: string) {
  const found = await prisma.leaveRequest.findUnique({
    where: { id },
    // The employee's login is pulled in for the decision notification. A
    // second query for one address would run on every decision path, and the
    // relation is already being joined.
    include: { employee: { include: { user: { select: { email: true } } } }, leaveType: true },
  })
  if (!found) throw new AppError(404, "Leave request not found")
  return found
}

/**
 * Tell the employee what was decided.
 *
 * After the transaction, and swallowed by `notify` inside the builder: a
 * decision that already committed must not be undone by a mail server. An
 * employee with no login has nobody to tell, which is not an error.
 */
async function notifyLeaveDecision(
  found: Awaited<ReturnType<typeof loadRequestOr404>>,
  approved: boolean,
  reason: string | null
): Promise<void> {
  const to = found.employee.user?.email
  if (!to) return
  await sendLeaveDecidedEmail({
    to,
    requestId: found.id,
    leaveType: found.leaveType.name,
    startDate: formatDateOnly(found.startDate),
    endDate: formatDateOnly(found.endDate),
    approved,
    reason,
  })
}

/** Re-reads the row after a decision so the response reflects what was stored. */
async function finishDecision(id: string): Promise<LeaveRequestItem> {
  const updated = await prisma.leaveRequest.findUnique({ where: { id }, include: REQUEST_INCLUDE })
  if (!updated) throw new AppError(404, "Leave request not found")

  const [deciders, calendar] = await Promise.all([
    resolveDeciders(updated.approvedBy ? [updated.approvedBy] : []),
    loadLeaveCalendar(updated.startDate, updated.endDate),
  ])
  return {
    id: updated.id,
    employee: updated.employee,
    leaveType: toLeaveTypeRef(updated.leaveType),
    startDate: formatDateOnly(updated.startDate),
    endDate: formatDateOnly(updated.endDate),
    startSession: updated.startSession,
    endSession: updated.endSession,
    days: chargedDays(updated, calendar),
    reason: updated.reason,
    status: updated.status,
    decidedBy: updated.approvedBy ? (deciders.get(updated.approvedBy) ?? null) : null,
    decidedAt: updated.decidedAt ? updated.decidedAt.toISOString() : null,
    decisionNote: updated.decisionNote,
    createdAt: updated.createdAt.toISOString(),
  }
}

export async function approveLeaveRequest(
  id: string,
  actorUserId: string
): Promise<LeaveRequestItem> {
  const found = await loadRequestOr404(id)
  if (found.status !== "PENDING") {
    throw new AppError(409, `This request is already ${found.status.toLowerCase()}`)
  }

  // Attendance status is derived, so approving a backdated sick day
  // retroactively flips it from ABSENT to ON_LEAVE — moving that month's
  // payable days after the fact. If the month was already paid, the money is
  // already wrong and nothing else notices. Sick leave may be backdated 30
  // days, so this is reachable in normal use, not a corner case.
  //
  // Both months, not just the start: a request cannot span two years (an
  // existing rule) but it can span two months, and `endDate`'s month may be
  // closed while `startDate`'s is still open.
  await assertMonthNotLocked(found.startDate)
  if (found.endDate.getUTCMonth() !== found.startDate.getUTCMonth()) {
    await assertMonthNotLocked(found.endDate)
  }

  const calendar = await loadLeaveCalendar(found.startDate, found.endDate)
  const days = countChargedDays(found.startDate, found.endDate, found, {
    countsHolidays: found.leaveType.countsHolidays,
    calendar,
  })

  // Re-check against APPROVED requests only. State moves between filing and
  // approval — without this, two 5-day requests against a 5-day balance both
  // pass at apply time and approving both grants 10.
  const clash = await prisma.leaveRequest.findFirst({
    where: {
      id: { not: id },
      employeeId: found.employeeId,
      status: "APPROVED",
      startDate: { lte: found.endDate },
      endDate: { gte: found.startDate },
    },
  })
  if (clash) {
    throw new AppError(409, "Another approved request now overlaps these dates")
  }

  if (!isUnpaidType(found.leaveType)) {
    const year = found.startDate.getUTCFullYear()
    const balances = await getBalancesForEmployee(found.employee, year)
    const balance = balances.find((b) => b.leaveTypeId === found.leaveTypeId)
    const entitlement = balance?.entitlement ?? 0
    const alreadyApproved = balance?.used ?? 0
    if (alreadyApproved + days > entitlement) {
      throw new AppError(409, "Balance is no longer sufficient — another request was approved first")
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.leaveRequest.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedBy: actorUserId,
        decidedAt: new Date(),
        decisionNote: null,
      },
    })
    // Punch flags are frozen at capture, so a leave approved after the punch
    // leaves `isLate` judged against a window that no longer applies. Same
    // transaction: a recompute that survived a rolled-back approval would
    // relax flags against leave that was never granted.
    await recomputePunchFlags(tx, found.employeeId, found.startDate, found.endDate)
    await emitEvent(tx, {
      ...leaveEvent({
        type: "leave.approved",
        verb: "approved",
        severity: "SUCCESS",
        actorUserId,
        request: { ...found, status: "APPROVED" },
        leaveType: found.leaveType,
        employee: found.employee,
        days,
      }),
    })
  })
  await notifyLeaveDecision(found, true, null)
  return finishDecision(id)
}

export async function rejectLeaveRequest(
  id: string,
  actorUserId: string,
  note: string
): Promise<LeaveRequestItem> {
  const found = await loadRequestOr404(id)
  if (found.status !== "PENDING") {
    throw new AppError(409, `This request is already ${found.status.toLowerCase()}`)
  }
  const days = chargedDays(found, await loadLeaveCalendar(found.startDate, found.endDate))

  await prisma.$transaction(async (tx) => {
    await tx.leaveRequest.update({
      where: { id },
      data: {
        status: "REJECTED",
        approvedBy: actorUserId,
        decidedAt: new Date(),
        decisionNote: note,
      },
    })
    await emitEvent(tx, {
      ...leaveEvent({
        type: "leave.rejected",
        verb: "rejected",
        // WARNING, not ERROR: a rejection is a decision, not a fault. ERROR
        // would put a red badge on a manager doing their job.
        severity: "WARNING",
        actorUserId,
        request: { ...found, status: "REJECTED" },
        leaveType: found.leaveType,
        employee: found.employee,
        days,
      }),
    })
  })
  await notifyLeaveDecision(found, false, note)
  return finishDecision(id)
}

export async function cancelLeaveRequest(
  id: string,
  actorUserId: string
): Promise<LeaveRequestItem> {
  const found = await loadRequestOr404(id)
  const self = await requireEmployeeForUser(actorUserId)
  if (found.employeeId !== self.id) {
    throw new AppError(403, "You can only cancel your own leave requests")
  }

  const notStarted = found.startDate.getTime() > todayUtc().getTime()
  const cancellable = found.status === "PENDING" || (found.status === "APPROVED" && notStarted)
  if (!cancellable) {
    throw new AppError(
      409,
      found.status === "APPROVED"
        ? "Leave that has already started cannot be cancelled"
        : `This request is already ${found.status.toLowerCase()}`
    )
  }

  const days = chargedDays(found, await loadLeaveCalendar(found.startDate, found.endDate))

  await prisma.$transaction(async (tx) => {
    await tx.leaveRequest.update({
      where: { id },
      data: { status: "CANCELLED", decidedAt: new Date() },
    })
    await emitEvent(tx, {
      ...leaveEvent({
        type: "leave.cancelled",
        verb: "cancelled",
        actorUserId,
        request: { ...found, status: "CANCELLED" },
        leaveType: found.leaveType,
        employee: found.employee,
        days,
      }),
    })
  })
  return finishDecision(id)
}

/**
 * **Emits nothing, deliberately.** Reverting is an administrative correction
 * of an approval that should not have happened, and "your approved leave was
 * un-approved" needs a wording decision rather than a mechanical mapping of
 * the other four. Named here so the gap reads as a choice, not an omission.
 */
export async function revertLeaveRequest(
  id: string,
  actorUserId: string,
  note: string
): Promise<LeaveRequestItem> {
  const found = await loadRequestOr404(id)
  if (found.status !== "APPROVED") {
    throw new AppError(409, "Only an approved request can be reverted")
  }
  if (found.startDate.getTime() <= todayUtc().getTime()) {
    throw new AppError(409, "Leave that has already started cannot be reverted")
  }
  await prisma.$transaction(async (tx) => {
    await tx.leaveRequest.update({
      where: { id },
      data: {
        status: "CANCELLED",
        approvedBy: actorUserId,
        decidedAt: new Date(),
        decisionNote: note,
      },
    })
    // Un-approving may leave a relaxed flag behind, marking someone on time
    // against a half-day window they are no longer entitled to. The helper
    // re-derives from whatever leave is approved *now* — which, after the
    // update above, no longer includes this request — so it needs no inverse.
    await recomputePunchFlags(tx, found.employeeId, found.startDate, found.endDate)
  })
  return finishDecision(id)
}
