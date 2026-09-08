/**
 * Enabling and disabling an employee's login.
 *
 * A sibling of `PATCH /api/users/:id/status` rather than a replacement for
 * it. That route keys on the **user** id, which no employee projection
 * exposes — and putting `userId` on `EmployeeView` to power one button would
 * hand every tier that sees an employment group a foreign key it has no use
 * for. This resolves the user id server-side from the employee id instead.
 *
 * `User.isActive` stays independent of `Employee.employmentStatus`; see the
 * comment on `EmploymentDetails.accountActive`.
 */

import prisma from "../../config/prisma"
import type { SalesRole } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import { revokeAllUserTokens } from "../auth/auth.service"
import { employmentAllowsSales } from "../sales/sales.eligibility"

export async function setAccountActive(
  employeeId: string,
  isActive: boolean
): Promise<{ id: string; accountActive: boolean }> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, userId: true },
  })
  if (!employee) throw new AppError(404, "Employee not found")

  const updated = await prisma.user.update({
    where: { id: employee.userId },
    data: { isActive },
    select: { id: true, isActive: true },
  })

  // Without this the access token keeps working until it expires and the
  // refresh cookie keeps minting new ones — the lockout would not take
  // effect for the length of a session. Matches updateUserStatusHandler.
  if (!isActive) await revokeAllUserTokens(employee.userId)

  return { id: employeeId, accountActive: updated.isActive }
}

export interface SetSalesRoleResult {
  salesRole: SalesRole | null
  /**
   * How many Sales Accounts this person still owns, present only when
   * revoking left them unable to work those accounts. Absent means there is
   * nothing to report — see the count inside `setSalesRole` for why this
   * informs rather than blocks.
   */
  orphanedAccounts?: number
}

/**
 * Grants or revokes the Sales Hub capability attached to an employee's login.
 * The account change and its audit row commit together; unchanged values are
 * returned without producing a misleading audit entry.
 */
export async function setSalesRole(
  employeeId: string,
  body: { salesRole: SalesRole | null },
  actor: AccessTokenPayload
): Promise<SetSalesRoleResult> {
  const outcome = await prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        fullName: true,
        employmentStatus: true,
        lastWorkingDay: true,
        user: { select: { id: true, salesRole: true } },
      },
    })
    if (!employee?.user) {
      throw new AppError(404, "That employee has no login account")
    }

    const before = employee.user.salesRole

    // Granting to someone who has left produces a role the door will not
    // honour anyway — effectiveSalesRole strips it from every token they
    // could be issued. Refusing here says so out loud, rather than letting HR
    // set a value that silently does nothing. Revoking (null) stays allowed:
    // tidying up after a departure must never be blocked.
    if (
      body.salesRole !== null &&
      !employmentAllowsSales(employee.employmentStatus, employee.lastWorkingDay)
    ) {
      throw new AppError(
        400,
        `${employee.fullName} has left the company, so Techno Sales Hub access cannot be granted. Reinstate their employment first.`
      )
    }
    if (before === body.salesRole) {
      return { result: { salesRole: before }, narrowedUserId: null, orphaned: 0 }
    }

    // Counted before the write, and only when access is going away entirely.
    // Revocation is deliberately not blocked — the account keeps its owner
    // for the record, and HR must never be stuck behind a Sales Hub rule —
    // but HR should not have to discover afterwards that four accounts now
    // have nobody able to work them. Same shape as the holiday and shift
    // writes, which report their impact rather than refusing.
    const orphaned =
      body.salesRole === null
        ? await tx.salesAccount.count({ where: { ownerEmployeeId: employee.id } })
        : 0

    await tx.user.update({
      where: { id: employee.user.id },
      data: { salesRole: body.salesRole },
    })

    await writeAudit(tx, {
      entity: "USER_ACCOUNT",
      entityId: employee.user.id,
      action: "UPDATE",
      changedBy: actor.sub,
      before: { salesRole: before },
      after: { salesRole: body.salesRole },
      note: `Sales Hub access for ${employee.fullName}`,
    })

    const narrowed =
      body.salesRole === null ||
      (before === "SALES_ADMIN" && body.salesRole === "SALES_USER")

    return {
      result: { salesRole: body.salesRole },
      narrowedUserId: narrowed ? employee.user.id : null,
      orphaned,
    }
  })

  // Outside the transaction, and after it: a rollback must not sign out a
  // user whose Sales Hub access never actually changed.
  if (outcome.narrowedUserId) {
    await revokeAllUserTokens(outcome.narrowedUserId)
  }

  // Omitted entirely when nothing was orphaned, so a caller can treat its
  // presence as "there is something to tell the user about".
  return outcome.orphaned > 0
    ? { ...outcome.result, orphanedAccounts: outcome.orphaned }
    : outcome.result
}
