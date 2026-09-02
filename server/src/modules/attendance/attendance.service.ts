import prisma from "../../config/prisma"
import type { Employee } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { formatDateOnly, parseDateOnly } from "../../utils/dates"
import type { AccessTokenPayload } from "../auth/auth.types"
import { buildDayGrid, effectiveShift, resolveShift, shiftInfo } from "./attendance.grid"
import { officeToday } from "./attendance.time"
import type { AttendanceDay, GridEmployee, TodayAttendance } from "./attendance.types"

/** The employee columns the grid needs, in the shape it expects. */
export const GRID_EMPLOYEE_SELECT = {
  id: true,
  joiningDate: true,
  employmentStatus: true,
  shiftId: true,
  lastWorkingDay: true,
} as const

export async function requireEmployeeForUser(userId: string): Promise<Employee> {
  const employee = await prisma.employee.findUnique({ where: { userId } })
  if (!employee) {
    throw new AppError(403, "This account has no employee profile, so it cannot record attendance")
  }
  return employee
}

function toGridEmployee(employee: Pick<Employee, keyof typeof GRID_EMPLOYEE_SELECT>): GridEmployee {
  return {
    id: employee.id,
    joiningDate: employee.joiningDate,
    employmentStatus: employee.employmentStatus,
    shiftId: employee.shiftId,
    lastWorkingDay: employee.lastWorkingDay,
  }
}

/** First and last day of a month, as UTC-midnight dates. */
export function monthRange(year: number, month: number): { from: Date; to: Date } {
  const from = new Date(Date.UTC(year, month - 1, 1))
  const to = new Date(Date.UTC(year, month, 0))
  return { from, to }
}

/** Defaults an absent range to the current office-local month. */
export function resolveRange(from?: string, to?: string): { from: Date; to: Date } {
  const today = officeToday()
  const fallback = monthRange(today.getUTCFullYear(), today.getUTCMonth() + 1)
  const start = from ? parseDateOnly(from) : fallback.from
  const end = to ? parseDateOnly(to) : fallback.to
  if (end < start) {
    throw new AppError(400, "The end of the range is before its start")
  }
  return { from: start, to: end }
}

export async function getDaysForEmployee(
  employee: Pick<Employee, keyof typeof GRID_EMPLOYEE_SELECT>,
  from: Date,
  to: Date
): Promise<AttendanceDay[]> {
  const grid = await buildDayGrid([toGridEmployee(employee)], from, to)
  return grid.get(employee.id) ?? []
}

export async function getMyAttendance(
  userId: string,
  from?: string,
  to?: string
): Promise<AttendanceDay[]> {
  const employee = await requireEmployeeForUser(userId)
  const range = resolveRange(from, to)
  return getDaysForEmployee(employee, range.from, range.to)
}

/**
 * Visibility is decided here rather than at the route, so the rule lives in
 * one place and the route stays a plain `requireAuth`. Mirrors how
 * `GET /api/leave/requests` scopes its own list.
 */
export async function assertCanViewEmployee(
  actor: AccessTokenPayload,
  employeeId: string
): Promise<void> {
  if (actor.role === "HR_ADMIN" || actor.role === "SUPER_ADMIN" || actor.role === "FINANCE_OFFICER") {
    return
  }

  const self = await requireEmployeeForUser(actor.sub)
  if (self.id === employeeId) return

  if (actor.role === "REPORTING_MANAGER") {
    const report = await prisma.employee.findFirst({
      where: { id: employeeId, reportingManagerId: self.id },
      select: { id: true },
    })
    if (report) return
  }

  throw new AppError(403, "You can only view your own attendance")
}

export async function getEmployeeAttendance(
  actor: AccessTokenPayload,
  employeeId: string,
  from?: string,
  to?: string
): Promise<AttendanceDay[]> {
  await assertCanViewEmployee(actor, employeeId)

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: GRID_EMPLOYEE_SELECT,
  })
  if (!employee) throw new AppError(404, "Employee not found")

  const range = resolveRange(from, to)
  return getDaysForEmployee(employee, range.from, range.to)
}

export async function getToday(userId: string): Promise<TodayAttendance> {
  const employee = await requireEmployeeForUser(userId)
  const date = officeToday()
  const [days, shifts] = await Promise.all([
    getDaysForEmployee(employee, date, date),
    prisma.shift.findMany(),
  ])

  const day = days[0]
  // Narrowed to the half actually worked, exactly as the grid, the punch,
  // approval and recompute all do. Without the wrapper the card printed the
  // full span and full expected hours while the log row directly beneath it,
  // the report and payroll all used the half — the same day reading two ways
  // on one screen.
  const shift = effectiveShift(
    resolveShift(toGridEmployee(employee), date, shifts),
    day.leaveFraction,
    day.leaveStartSession ?? "FIRST_HALF"
  )

  return {
    // Anchors the client's ticking clock. Without it every punch card is
    // only as accurate as the laptop it runs on, and a machine a few minutes
    // fast tells someone they are on time while the server flags them late.
    serverTime: new Date().toISOString(),
    date: formatDateOnly(date),
    status: day.status,
    checkIn: day.checkIn,
    checkOut: day.checkOut,
    workedHours: day.workedHours,
    isLate: day.isLate,
    isEarlyOut: day.isEarlyOut,
    approval: day.approval,
    shift: shiftInfo(shift),
    // Never inferred by the client: the server owns what "today" is.
    canCheckIn: day.attendanceId === null,
    canCheckOut: day.checkIn !== null && day.checkOut === null,
    detail: day.detail,
  }
}
