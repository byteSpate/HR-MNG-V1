import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import { assertMonthNotLocked } from "../../utils/month-lock"
import { projectAvatar } from "../auth/auth.me"
import { generateTemporaryPassword, hashPassword } from "../auth/auth.utils"
import { sendCredentialsEmail } from "../auth/mailer"
import { emitEvent } from "../event/event.emit"
import { EMPLOYEE_INCLUDE, projectEmployee, visibilityTierFor } from "./employee.access"
import { computeBlockers } from "./employee.blockers"
import { employeeExitedEvent, employeeJoinedEvent } from "./employee.events"
import { listDocuments } from "./employee.media"
import type { AccessTokenPayload } from "../auth/auth.types"
import type { ExitDetailsBody } from "../settlement/settlement.validators"
import type { CreateStaffAccountInput, CreateStaffAccountResult, EmployeeView, MyProfileResponse } from "./employee.types"
import type { SetSalaryStructureBody } from "./employee.validators"

const CODE_PREFIX: Record<CreateStaffAccountInput["role"], string> = {
  EMPLOYEE: "EMP",
  REPORTING_MANAGER: "MNG",
}

/**
 * Shared by creation and editing, because a reporting line has to mean the
 * same thing however it was set. Holding two copies of this rule is how one
 * path ends up accepting a manager the other would reject.
 *
 * The caller owns the "not themselves" check: it is meaningful when editing an
 * existing employee and impossible at creation, where the subject has no id yet.
 */
export async function assertIsReportingManager(managerId: string): Promise<void> {
  const manager = await prisma.employee.findUnique({
    where: { id: managerId },
    include: { user: { select: { role: true } } },
  })
  if (!manager) throw new AppError(400, "Reporting manager not found")
  if (manager.user.role !== "REPORTING_MANAGER") {
    throw new AppError(400, "That employee is not a reporting manager")
  }
}

/**
 * @param actorUserId The HR user creating the account. Optional so the seed
 *   and existing callers are unaffected; a null actor on the event reads as
 *   "the system did it", which for a seeded account is true.
 */
export async function createStaffAccount(
  input: CreateStaffAccountInput,
  actorUserId?: string
): Promise<CreateStaffAccountResult> {
  const email = input.email.trim().toLowerCase()
  const fullName = input.fullName.trim()
  const designation = input.designation.trim()

  // Pre-checked so a bad id is a 400 naming the thing, not a foreign-key 500.
  const department = await prisma.department.findUnique({ where: { id: input.departmentId } })
  if (!department) throw new AppError(400, "Department not found")

  if (input.reportingManagerId) {
    await assertIsReportingManager(input.reportingManagerId)
  }

  if (input.shiftId) {
    const shift = await prisma.shift.findUnique({ where: { id: input.shiftId } })
    if (!shift) throw new AppError(400, "Shift not found")
  }

  const temporaryPassword = generateTemporaryPassword()
  const passwordHash = await hashPassword(temporaryPassword)
  const prefix = CODE_PREFIX[input.role]

  let employeeCode: string
  try {
    employeeCode = await prisma.$transaction(async (tx) => {
      const counter = await tx.idCounter.upsert({
        where: { id: prefix },
        update: { value: { increment: 1 } },
        create: { id: prefix, value: 1 },
      })
      const code = `BS-${prefix}-${String(counter.value).padStart(5, "0")}`

      const user = await tx.user.create({
        data: { email, passwordHash, role: input.role, mustChangePassword: true },
      })

      const employee = await tx.employee.create({
        data: {
          userId: user.id,
          employeeCode: code,
          fullName,
          designation,
          departmentId: input.departmentId,
          employmentType: input.employmentType,
          joiningDate: new Date(`${input.joiningDate}T00:00:00.000Z`),
          reportingManagerId: input.reportingManagerId,
          shiftId: input.shiftId,
        },
      })

      await emitEvent(
        tx,
        employeeJoinedEvent({
          employeeId: employee.id,
          fullName: employee.fullName,
          designation: employee.designation,
          employeeCode: code,
          actorUserId: actorUserId ?? null,
        })
      )

      return code
    })
  } catch (err) {
    // Caught AROUND the transaction, not inside it: the unique violation on
    // User.email aborts the transaction, and catching inside would try to
    // continue on a dead one.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      throw new AppError(409, "An account with this email already exists")
    }
    throw err
  }

  await sendCredentialsEmail({
    to: email,
    identifier: employeeCode,
    identifierLabel: "Employee ID",
    temporaryPassword,
  }).catch((err) => {
    // Deliberately swallowed: a dead SMTP server must not roll back a created
    // employee. No longer silent — the failure leaves an EmailDispatch row
    // with `error` set.
    console.error("Failed to send credentials email", err)
  })

  return { employeeCode, temporaryPassword, fullName, email }
}

/**
 * The viewer's own employee id, or null for an administrative account.
 *
 * Needed by `visibilityTierFor` to answer "is the subject one of my direct
 * reports", which is a comparison between two *employee* ids while the token
 * only carries a user id.
 */
export async function employeeIdForUser(userId: string): Promise<string | null> {
  const row = await prisma.employee.findUnique({
    where: { userId },
    select: { id: true },
  })
  return row?.id ?? null
}

export async function getEmployee(
  viewer: AccessTokenPayload,
  id: string
): Promise<EmployeeView> {
  const employee = await prisma.employee.findUnique({
    where: { id },
    include: EMPLOYEE_INCLUDE,
  })
  if (!employee) throw new AppError(404, "Employee not found")

  const viewerEmployeeId = await employeeIdForUser(viewer.sub)
  const tier = visibilityTierFor(viewer, employee, viewerEmployeeId)

  // Documents and blockers are SELF/FULL only. A blocker names an operational
  // gap and is HR's work queue; it is not information Finance or a manager
  // acts on.
  if (tier !== "SELF" && tier !== "FULL") {
    return projectEmployee(employee, tier)
  }
  const documents = await listDocuments(id)
  const blockers = computeBlockers(
    employee,
    documents.map((d) => d.type)
  )
  const pendingRequest = await prisma.employeeChangeRequest.findFirst({
    where: { employeeId: id, field: "NATIONAL_ID", status: "PENDING" },
    orderBy: { createdAt: "desc" },
  })
  return projectEmployee(
    employee,
    tier,
    documents,
    blockers,
    pendingRequest
      ? {
          id: pendingRequest.id,
          newValue: pendingRequest.newValue,
          requestedAt: pendingRequest.createdAt.toISOString(),
        }
      : null
  )
}

/**
 * The account half of the profile, read from the row rather than the token.
 *
 * Email, role and mustChangePassword were taken straight off the JWT, which
 * is why this page could only ever show three things — none of which needed a
 * query. `createdAt` and the session list do, and they are what make an
 * administrative profile worth opening.
 *
 * One round trip: the tokens come back on the include rather than as a second
 * count, because this endpoint is on the path of every role.
 */
async function accountFor(viewer: AccessTokenPayload): Promise<MyProfileResponse["account"]> {
  const now = new Date()
  const row = await prisma.user.findUnique({
    where: { id: viewer.sub },
    select: {
      createdAt: true,
      displayName: true,
      avatarUrl: true,
      refreshTokens: {
        where: { revokedAt: null, expiresAt: { gt: now } },
        // `lastUsedAt`, not `createdAt`: rotation rewrites the row, so
        // createdAt is the age of the token rather than of the session.
        select: { lastUsedAt: true },
        orderBy: { lastUsedAt: "desc" },
      },
    },
  })

  const tokens = row?.refreshTokens ?? []

  return {
    email: viewer.email,
    role: viewer.role,
    mustChangePassword: viewer.mustChangePassword,
    displayName: row?.displayName ?? null,
    avatarUrl: projectAvatar(row?.avatarUrl ?? null),
    // The token is valid, so the row exists; the fallback is for the sliver
    // between a deletion and the token expiring, and must not be a crash.
    createdAt: (row?.createdAt ?? now).toISOString(),
    sessions: {
      count: tokens.length,
      // The newest rotation, which is the closest thing to "last seen" that
      // exists. Never presented as a sign-in time — see AccountSessions.
      lastActiveAt: tokens[0]?.lastUsedAt.toISOString() ?? null,
    },
  }
}

export async function getMyProfile(viewer: AccessTokenPayload): Promise<MyProfileResponse> {
  const account = await accountFor(viewer)
  const employee = await prisma.employee.findUnique({
    where: { userId: viewer.sub },
    include: EMPLOYEE_INCLUDE,
  })
  // `employee: null` rather than a 404. Having no employee record is the
  // normal case for SUPER_ADMIN, HR_ADMIN and FINANCE_OFFICER, not an error.
  if (!employee) return { account, employee: null }

  const documents = await listDocuments(employee.id)
  const blockers = computeBlockers(
    employee,
    documents.map((d) => d.type)
  )
  const pendingRequest = await prisma.employeeChangeRequest.findFirst({
    where: { employeeId: employee.id, field: "NATIONAL_ID", status: "PENDING" },
    orderBy: { createdAt: "desc" },
  })
  return {
    account,
    employee: projectEmployee(
      employee,
      "SELF",
      documents,
      blockers,
      pendingRequest
        ? {
            id: pendingRequest.id,
            newValue: pendingRequest.newValue,
            requestedAt: pendingRequest.createdAt.toISOString(),
          }
        : null
    ),
  }
}

/**
 * One endpoint, three surfaces.
 *
 * Each row is projected at the caller's tier, so this serves HR's full
 * directory, Finance's payroll-scoped directory, and the company-wide
 * colleague directory — because the COLLEAGUE projection *is* the colleague
 * card.
 */
export async function listEmployees(viewer: AccessTokenPayload): Promise<EmployeeView[]> {
  const [employees, viewerEmployeeId] = await Promise.all([
    prisma.employee.findMany({ include: EMPLOYEE_INCLUDE, orderBy: { fullName: "asc" } }),
    employeeIdForUser(viewer.sub),
  ])
  return employees.map((e) =>
    projectEmployee(e, visibilityTierFor(viewer, e, viewerEmployeeId))
  )
}

/**
 * Puts an employee on a pay structure.
 *
 * The split is deliberate and is the reason this lives here rather than in the
 * payroll module: **Finance defines structures, HR assigns people to them.**
 * Neither role can invent a salary and pay it alone — HR may only choose from
 * bands Finance authored, and Finance cannot decide who sits in which band.
 *
 * No month lock. Reassigning does not disturb a paid month: a payslip is a
 * frozen snapshot holding its own figures, not a reference to the structure,
 * so June stays exactly as June was paid. The change lands on the next run.
 */
export async function setSalaryStructure(
  employeeId: string,
  actorUserId: string,
  body: SetSalaryStructureBody
) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { salaryStructure: true },
  })
  if (!employee) throw new AppError(404, "Employee not found")

  let structure = null
  if (body.salaryStructureId !== null) {
    structure = await prisma.salaryStructure.findUnique({
      where: { id: body.salaryStructureId },
    })
    if (!structure) throw new AppError(404, "Salary structure not found")
    // An inactive structure is one Finance has retired. Assigning to it would
    // pay a band that is no longer authorised.
    if (!structure.isActive) {
      throw new AppError(409, `"${structure.name}" is inactive and cannot be assigned`)
    }
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.employee.update({
      where: { id: employeeId },
      data: { salaryStructureId: body.salaryStructureId },
      include: { salaryStructure: true },
    })
    await writeAudit(tx, {
      entity: "EMPLOYEE_SALARY_STRUCTURE",
      entityId: employeeId,
      action: "UPDATE",
      changedBy: actorUserId,
      before: { salaryStructure: employee.salaryStructure?.name ?? null },
      after: { salaryStructure: structure?.name ?? null },
    })
    return updated
  })
}

/**
 * Records the facts a settlement is computed from. HR owns this; the enum
 * drives money, so it is not a filing category.
 */
export async function setExitDetails(
  employeeId: string,
  actorUserId: string,
  body: ExitDetailsBody
) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } })
  if (!employee) throw new AppError(404, "Employee not found")

  const lastWorkingDay = new Date(`${body.lastWorkingDay}T00:00:00.000Z`)
  if (lastWorkingDay.getTime() < employee.joiningDate.getTime()) {
    throw new AppError(400, "The last working day cannot precede the joining date")
  }

  // Otherwise a settlement would pay days a run already paid — the exact
  // overlap the run's roster rule exists to prevent.
  await assertMonthNotLocked(lastWorkingDay)

  // Those fields *are* the money once a settlement has been agreed.
  const settled = await prisma.settlement.findFirst({
    where: { employeeId, status: { in: ["APPROVED", "PAID"] } },
  })
  if (settled) {
    throw new AppError(
      409,
      `This employee's settlement is already ${settled.status.toLowerCase()}. Exit details are frozen once a settlement is approved.`
    )
  }

  // §22/§23 are employer-ended; the rest read as the employee leaving.
  const employmentStatus =
    body.exitReason === "TERMINATION" ||
    body.exitReason === "DISMISSAL" ||
    body.exitReason === "DISCHARGE" ||
    body.exitReason === "RETRENCHMENT"
      ? "TERMINATED"
      : "RESIGNED"

  return prisma.$transaction(async (tx) => {
    const updated = await tx.employee.update({
      where: { id: employeeId },
      data: {
        lastWorkingDay,
        exitReason: body.exitReason,
        exitNote: body.exitNote,
        employmentStatus,
      },
    })
    await writeAudit(tx, {
      entity: "EMPLOYEE_EXIT",
      entityId: employeeId,
      action: "UPDATE",
      changedBy: actorUserId,
      before: {
        lastWorkingDay: employee.lastWorkingDay?.toISOString().slice(0, 10) ?? null,
        exitReason: employee.exitReason,
        employmentStatus: employee.employmentStatus,
      },
      after: {
        lastWorkingDay: body.lastWorkingDay,
        exitReason: body.exitReason,
        employmentStatus,
      },
      note: body.exitNote,
    })
    await emitEvent(
      tx,
      employeeExitedEvent({
        employeeId,
        fullName: employee.fullName,
        exitReason: body.exitReason,
        lastWorkingDay: body.lastWorkingDay,
        actorUserId,
      })
    )
    return updated
  })
}
