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

/**
 * Grants or revokes the Sales Hub capability attached to an employee's login.
 * The account change and its audit row commit together; unchanged values are
 * returned without producing a misleading audit entry.
 */
export async function setSalesRole(
  employeeId: string,
  body: { salesRole: SalesRole | null },
  actor: AccessTokenPayload
): Promise<{ salesRole: SalesRole | null }> {
  const outcome = await prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        fullName: true,
        user: { select: { id: true, salesRole: true } },
      },
    })
    if (!employee?.user) {
      throw new AppError(404, "That employee has no login account")
    }

    const before = employee.user.salesRole
    if (before === body.salesRole) {
      return { result: { salesRole: before }, narrowedUserId: null }
    }

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
    }
  })

  // Outside the transaction, and after it: a rollback must not sign out a
  // user whose Sales Hub access never actually changed.
  if (outcome.narrowedUserId) {
    await revokeAllUserTokens(outcome.narrowedUserId)
  }

  return outcome.result
}
