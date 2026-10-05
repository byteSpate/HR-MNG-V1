import type { Prisma } from "../../../generated/prisma/client"
import prisma from "../../../config/prisma"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { isSalesAdmin } from "../sales.access"
import { lockAccountRow } from "./account.service"
import { assertNoOngoingOpportunities } from "./removal.shared"
import {
  namesOf,
  presentRemoval,
  REQUEST_ALREADY_DECIDED,
  ROW_INCLUDE,
  type RemovalRequestRow,
} from "./removal.service"

const ONLY_ADMIN_DECIDES = "Only a Sales Admin can approve or refuse this request."

/**
 * The Sales Account row is locked first, then the request is read, so a Sales
 * Admin approving while the Owner cancels (or the Owner changes) cannot both
 * win. Anything other than PENDING is refused: never applied twice.
 */
async function loadPending(tx: Prisma.TransactionClient, id: string) {
  const peek = await tx.salesCollaboratorRemoval.findUnique({ where: { id }, select: { salesAccountId: true } })
  if (!peek) throw new AppError(404, "That request does not exist.")
  await lockAccountRow(tx as typeof prisma, peek.salesAccountId)

  const current = await tx.salesCollaboratorRemoval.findUnique({ where: { id }, include: ROW_INCLUDE })
  if (!current) throw new AppError(404, "That request does not exist.")
  if (current.status !== "PENDING") throw new AppError(409, REQUEST_ALREADY_DECIDED)
  return current
}

export async function approveRemoval(id: string, actor: AccessTokenPayload): Promise<RemovalRequestRow> {
  if (!isSalesAdmin(actor)) throw new AppError(403, ONLY_ADMIN_DECIDES)

  const row = await prisma.$transaction(async (tx) => {
    const current = await loadPending(tx, id)
    // An Opportunity can be given to them while the request waits.
    await assertNoOngoingOpportunities(tx, current.salesAccountId, current.employeeId, current.employee.fullName)

    await tx.salesAccountAssignment.deleteMany({
      where: { salesAccountId: current.salesAccountId, employeeId: current.employeeId },
    })
    const updated = await tx.salesCollaboratorRemoval.update({
      where: { id },
      data: { status: "APPROVED", decidedBy: actor.sub, decidedAt: new Date() },
      include: ROW_INCLUDE,
    })
    await writeAudit(tx, {
      entity: "SALES_COLLABORATOR_REMOVAL",
      entityId: id,
      action: "APPROVE",
      changedBy: actor.sub,
      before: { status: "PENDING" },
      after: { status: "APPROVED" },
    })
    await writeAudit(tx, {
      entity: "SALES_ACCOUNT_ASSIGNMENT",
      entityId: current.salesAccountId,
      action: "DELETE",
      changedBy: actor.sub,
      before: { employeeId: current.employeeId },
      note: `${current.employee.fullName} removed after approval`,
    })
    return updated
  })
  return presentRemoval(row as never, await namesOf([row.requestedBy]))
}

export async function refuseRemoval(
  id: string,
  body: { reason: string },
  actor: AccessTokenPayload
): Promise<RemovalRequestRow> {
  if (!isSalesAdmin(actor)) throw new AppError(403, ONLY_ADMIN_DECIDES)

  const row = await prisma.$transaction(async (tx) => {
    await loadPending(tx, id)
    const updated = await tx.salesCollaboratorRemoval.update({
      where: { id },
      data: { status: "REFUSED", refusalReason: body.reason, decidedBy: actor.sub, decidedAt: new Date() },
      include: ROW_INCLUDE,
    })
    await writeAudit(tx, {
      entity: "SALES_COLLABORATOR_REMOVAL",
      entityId: id,
      action: "REJECT",
      changedBy: actor.sub,
      before: { status: "PENDING" },
      after: { status: "REFUSED", reason: body.reason },
    })
    return updated
  })
  return presentRemoval(row as never, await namesOf([row.requestedBy]))
}
