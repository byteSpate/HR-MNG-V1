import type { Prisma } from "../../../generated/prisma/client"
import prisma from "../../../config/prisma"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { ACCOUNT_NOT_VISIBLE, employeeIdFor, isSalesAdmin } from "../sales.access"
import { canBeAccountOwner, employmentAllowsSales } from "../sales.eligibility"
import { assertOwnerOrAdmin } from "./account.owner-rules"
import { listSalesEligibleEmployees, lockAccountRow, standingOf, type SalesEligibleEmployee } from "./account.service"
import { assertNoOngoingOpportunities, closePendingRemovals } from "./removal.shared"

export const MAY_NOT_ADD_COLLABORATOR = "Only the Owner or a Sales Admin can add a collaborator."

/** The Sales Account row, locked, with who owns it and who already collaborates. */
async function loadLocked(tx: Prisma.TransactionClient, accountId: string) {
  await lockAccountRow(tx as typeof prisma, accountId)
  const account = await tx.salesAccount.findUnique({
    where: { id: accountId },
    select: { id: true, name: true, ownerEmployeeId: true, assignments: { select: { employeeId: true } } },
  })
  if (!account) throw new AppError(404, ACCOUNT_NOT_VISIBLE)
  return account
}

/** The same four sentences creating a Sales Account uses for a collaborator. */
function assertEligibleCollaborator(employee: Parameters<typeof standingOf>[0] & { fullName: string }) {
  if (!employee.user?.salesRole) {
    throw new AppError(
      400,
      `${employee.fullName} does not have Techno Sales Hub access yet. Grant it from their employee record first.`
    )
  }
  if (!employmentAllowsSales(employee.employmentStatus, employee.lastWorkingDay)) {
    throw new AppError(400, `${employee.fullName} has left the company and cannot be added as a collaborator.`)
  }
  if (!employee.user.isActive) {
    throw new AppError(400, `${employee.fullName}'s login has been deactivated, so they cannot open the hub.`)
  }
  if (!canBeAccountOwner(standingOf(employee))) {
    throw new AppError(
      400,
      `${employee.fullName} is a Sales Admin and already has access to every Sales Account. They do not need to be added as a collaborator.`
    )
  }
}

/**
 * The Owner, or a Sales Admin, adds a collaborator to an existing Sales
 * Account. A Sales User also needs the `account.edit` switch: the route checks
 * that. Adding through an Opportunity (`addAssignment`) is unchanged.
 */
export async function addCollaborator(
  accountId: string,
  body: { employeeId: string },
  actor: AccessTokenPayload
): Promise<{ id: string; fullName: string }> {
  const actorEmployeeId = await employeeIdFor(actor)

  return prisma.$transaction(async (tx) => {
    const account = await loadLocked(tx, accountId)
    assertOwnerOrAdmin(actor, actorEmployeeId, account.ownerEmployeeId, MAY_NOT_ADD_COLLABORATOR)

    const employee = await tx.employee.findUnique({
      where: { id: body.employeeId },
      select: {
        id: true,
        fullName: true,
        employmentStatus: true,
        lastWorkingDay: true,
        user: { select: { salesRole: true, isActive: true } },
      },
    })
    if (!employee) throw new AppError(400, "That person is not an employee")

    if (employee.id === account.ownerEmployeeId) {
      throw new AppError(400, `${employee.fullName} is already the Owner of this Sales Account.`)
    }
    if (account.assignments.some((a) => a.employeeId === employee.id)) {
      throw new AppError(409, `${employee.fullName} is already a collaborator on this Sales Account.`)
    }
    assertEligibleCollaborator(employee)

    await tx.salesAccountAssignment.create({
      data: { salesAccountId: account.id, employeeId: employee.id, assignedBy: actor.sub },
    })
    await writeAudit(tx, {
      entity: "SALES_ACCOUNT_ASSIGNMENT",
      entityId: account.id,
      action: "ASSIGN",
      changedBy: actor.sub,
      after: { employeeId: employee.id },
      note: `${employee.fullName} added as a collaborator`,
    })
    return { id: employee.id, fullName: employee.fullName }
  })
}

/**
 * Who the Owner may add. The same people the create form offers, minus the
 * Owner and the collaborators already on it. A separate route from
 * `GET /employees` because that one needs `account.create`.
 */
export async function listCollaboratorOptions(
  accountId: string,
  actor: AccessTokenPayload
): Promise<SalesEligibleEmployee[]> {
  const actorEmployeeId = await employeeIdFor(actor)
  const account = await prisma.salesAccount.findUnique({
    where: { id: accountId },
    select: { id: true, ownerEmployeeId: true, assignments: { select: { employeeId: true } } },
  })
  if (!account) throw new AppError(404, ACCOUNT_NOT_VISIBLE)
  assertOwnerOrAdmin(actor, actorEmployeeId, account.ownerEmployeeId, MAY_NOT_ADD_COLLABORATOR)

  const taken = new Set([account.ownerEmployeeId, ...account.assignments.map((a) => a.employeeId)])
  return (await listSalesEligibleEmployees()).filter((person) => !taken.has(person.id))
}

/**
 * A Sales Admin takes a collaborator off a Sales Account at once. No request is
 * needed: an admin is who a request goes to. A Sales User, even the Owner, must
 * ask (`removal.service.ts`).
 */
export async function removeCollaboratorDirect(
  accountId: string,
  employeeId: string,
  actor: AccessTokenPayload
): Promise<void> {
  if (!isSalesAdmin(actor)) {
    throw new AppError(403, "Only a Sales Admin can remove a collaborator at once. Ask a Sales Admin, or send a request.")
  }

  await prisma.$transaction(async (tx) => {
    const account = await loadLocked(tx, accountId)
    if (!account.assignments.some((a) => a.employeeId === employeeId)) {
      throw new AppError(404, "That person is not a collaborator on this Sales Account.")
    }
    const person = await tx.employee.findUnique({ where: { id: employeeId }, select: { id: true, fullName: true } })
    await assertNoOngoingOpportunities(tx, accountId, employeeId, person?.fullName ?? "That person")

    await tx.salesAccountAssignment.deleteMany({ where: { salesAccountId: accountId, employeeId } })
    await writeAudit(tx, {
      entity: "SALES_ACCOUNT_ASSIGNMENT",
      entityId: accountId,
      action: "DELETE",
      changedBy: actor.sub,
      before: { employeeId },
      note: `${person?.fullName ?? "A collaborator"} removed by a Sales Admin`,
    })
    await closePendingRemovals(tx, { salesAccountId: accountId, employeeId }, "APPROVED", actor.sub)
  })
}
