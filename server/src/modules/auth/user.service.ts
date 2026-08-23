/**
 * Account administration: the User row, not the Employee record.
 *
 * The split matters. `/admin/employees` owns employment — department,
 * designation, salary, exit. This owns the login: email, role, and whether
 * the account works at all. The three administrative roles have no Employee
 * row, so this is the only place they can be managed from.
 *
 * Nothing here hard-deletes. Deactivation (`isActive = false`) is the delete:
 * `auth.service` already refuses login, refresh and rotation on it, the row
 * and every foreign key to it survive, and it is reversible.
 */

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import type { Role } from "../../generated/prisma/client"
import { emitEvent } from "../event/event.emit"
import { generateTemporaryPassword, hashPassword } from "./auth.utils"
import { sendCredentialsEmail } from "./mailer"
import { isPromotion, roleChangedEvent } from "./user.events"
import { revokeAllUserTokens } from "./auth.service"

export interface UserAccount {
  id: string
  email: string
  role: Role
  isActive: boolean
  mustChangePassword: boolean
  createdAt: string
  employee: { id: string; employeeCode: string; fullName: string } | null
}

/**
 * One select, every handler. `passwordHash` is absent by construction rather
 * than deleted afterwards — a shape built by spreading the row would ship it
 * the first time somebody adds a field.
 */
export const USER_ACCOUNT_SELECT = {
  id: true,
  email: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  createdAt: true,
  employee: { select: { id: true, employeeCode: true, fullName: true } },
} as const

type UserRow = {
  id: string
  email: string
  role: Role
  isActive: boolean
  mustChangePassword: boolean
  createdAt: Date
  employee: { id: string; employeeCode: string; fullName: string } | null
}

function toAccount(row: UserRow): UserAccount {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    createdAt: row.createdAt.toISOString(),
    employee: row.employee,
  }
}

export async function listUsers(): Promise<UserAccount[]> {
  const rows = await prisma.user.findMany({
    select: USER_ACCOUNT_SELECT,
    orderBy: { createdAt: "desc" },
  })
  return (rows as UserRow[]).map(toAccount)
}

/**
 * An administrative account with no Employee record.
 *
 * The role is narrowed by `createUserSchema` to the three roles that have no
 * employment side. EMPLOYEE and REPORTING_MANAGER go through
 * POST /api/employees/staff, which collects the department, designation,
 * employment type and joining date an Employee row requires.
 *
 * The temporary password is returned exactly once, in this response. It is
 * never stored in plaintext and never retrievable afterwards — the same
 * contract createStaffAccount has.
 */
export async function createUser(input: {
  email: string
  role: Role
}): Promise<{ id: string; email: string; role: Role; temporaryPassword: string }> {
  const email = input.email.trim().toLowerCase()

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (existing) throw new AppError(409, "An account with that email already exists")

  const temporaryPassword = generateTemporaryPassword()
  const passwordHash = await hashPassword(temporaryPassword)

  const user = await prisma.user.create({
    data: { email, passwordHash, role: input.role, mustChangePassword: true },
    select: { id: true, email: true, role: true },
  })

  // Swallowed, like the staff path: a dead SMTP server must not fail account
  // creation, and the temporary password is still returned below as the
  // fallback. The failure is recorded as an EmailDispatch row.
  await sendCredentialsEmail({
    to: user.email,
    identifier: user.email,
    identifierLabel: "Email address",
    temporaryPassword,
  }).catch((err) => {
    console.error("Failed to send credentials email", err)
  })

  return { id: user.id, email: user.email, role: user.role, temporaryPassword }
}

/**
 * Refuses to leave the system with nobody who can administer it.
 *
 * Counts ACTIVE super admins, not all of them: three super admins where two
 * are already deactivated is still one step from a locked system.
 *
 * Only checked when deactivating or demoting. Reactivating the second-to-last
 * admin is always safe, and running the count there would be a query that can
 * only ever pass.
 */
async function assertNotLastActiveSuperAdmin(user: { id: string; role: Role }): Promise<void> {
  if (user.role !== "SUPER_ADMIN") return
  const activeAdmins = await prisma.user.count({
    where: { role: "SUPER_ADMIN", isActive: true },
  })
  if (activeAdmins <= 1) {
    throw new AppError(409, "This is the last active super admin. Promote another one first.")
  }
}

/**
 * The soft delete. `isActive = false` locks the account out — auth.service
 * refuses login, refresh and rotation on it — while the row and every foreign
 * key to it survive, and the change is reversible.
 */
export async function setUserStatus(
  actorUserId: string,
  targetUserId: string,
  isActive: boolean
): Promise<UserAccount> {
  // Before the lookup: the caller does not need to exist for this to be wrong.
  if (!isActive && actorUserId === targetUserId) {
    throw new AppError(409, "You cannot deactivate your own account")
  }

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: USER_ACCOUNT_SELECT,
  })
  if (!target) throw new AppError(404, "User not found")

  if (!isActive) await assertNotLastActiveSuperAdmin(target)

  const updated = await prisma.user.update({
    where: { id: targetUserId },
    data: { isActive },
    select: USER_ACCOUNT_SELECT,
  })

  // The access token survives until it expires and the refresh cookie keeps
  // minting new ones, so without this the lockout does not take effect for
  // the length of a session.
  if (!isActive) await revokeAllUserTokens(targetUserId)

  return toAccount(updated as UserRow)
}

const EMPLOYEE_TIER_ROLES: readonly Role[] = ["EMPLOYEE", "REPORTING_MANAGER"]

/**
 * Changing what an account is allowed to do.
 *
 * Promotion out of an employee role is safe: the Employee row stays, so
 * payroll, leave and attendance keep resolving through it. The employeeCode
 * prefix (BS-EMP-) goes stale, which is correct — it records what they were
 * hired as, not what they are now. It cannot be reissued in any case: staff
 * log in with it (`loginStaff`), it is the first column of the bank file, and
 * it is the join key every spreadsheet import resolves rows through.
 *
 * The two refusals below are the directions that break something.
 *
 * Two things happen after the write, and neither is optional:
 *
 * **The change is announced.** Until this existed a promotion changed one
 * column and told nobody — not HR, not the person it happened to. The event
 * goes out in the same transaction as the update, so a role can never change
 * silently.
 *
 * **A demotion ends the session.** The role is a JWT claim, so the old one
 * survives for the access token's full life while the refresh cookie keeps
 * minting new ones — exactly the reasoning `setUserStatus` already applies to
 * a deactivation. A promotion is left alone: nothing was taken away, so there
 * is nothing to cut short, and bouncing somebody to the login screen for
 * being promoted is a poor way to hear it.
 */
export async function setUserRole(
  actorUserId: string,
  targetUserId: string,
  role: Role
): Promise<UserAccount> {
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: USER_ACCOUNT_SELECT,
  })
  if (!target) throw new AppError(404, "User not found")

  const current = target as UserRow
  if (current.role === role) return toAccount(current)

  // An employee-tier role without an Employee row makes employeeIdForUser
  // return null, and leave, insights, attendance and the employee update
  // path all resolve a caller through it.
  if (EMPLOYEE_TIER_ROLES.includes(role) && current.employee === null) {
    throw new AppError(
      400,
      "This account has no employee record, so it cannot hold an employee or manager role"
    )
  }

  // assertIsReportingManager gates on user.role, so demoting a manager leaves
  // their reports pointing at somebody the system no longer accepts as one.
  if (current.role === "REPORTING_MANAGER" && current.employee !== null) {
    const subordinates = await prisma.employee.count({
      where: { reportingManagerId: current.employee.id },
    })
    if (subordinates > 0) {
      throw new AppError(
        409,
        `This manager still has ${subordinates} direct report${subordinates === 1 ? "" : "s"}. Reassign them first.`
      )
    }
  }

  await assertNotLastActiveSuperAdmin(current)

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.user.update({
      where: { id: targetUserId },
      data: { role },
      select: USER_ACCOUNT_SELECT,
    })

    await emitEvent(
      tx,
      roleChangedEvent({
        targetUserId,
        subjectEmployeeId: current.employee?.id ?? null,
        // An administrative account has no Employee row and therefore no name
        // anywhere; the login email is the only thing that identifies it.
        displayName: current.employee?.fullName ?? current.email,
        from: current.role,
        to: role,
        actorUserId,
      })
    )

    return row
  })

  // Outside the transaction, and after it: revoking tokens for a change that
  // then rolled back would sign somebody out of a role they still hold.
  if (!isPromotion(current.role, role)) {
    await revokeAllUserTokens(targetUserId)
  }

  return toAccount(updated as UserRow)
}
