import type { Prisma } from "../../../generated/prisma/client"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"

/**
 * A collaborator who is the Opportunity Owner of an Ongoing Opportunity on the
 * Sales Account cannot be removed: they would own something they can no longer
 * open. Checked when a request is made, when a Sales Admin removes directly,
 * and again when a request is approved, because an Opportunity can be given to
 * them while the request waits. Only Ongoing ones count: a closed Opportunity
 * does not trap a person on a Sales Account.
 */
export async function assertNoOngoingOpportunities(
  tx: Prisma.TransactionClient,
  accountId: string,
  employeeId: string,
  fullName: string
): Promise<void> {
  const owned = await tx.opportunity.count({
    where: { salesAccountId: accountId, ownerEmployeeId: employeeId, status: "ONGOING" },
  })
  if (owned > 0) {
    throw new AppError(
      409,
      `${fullName} is the Opportunity Owner of an Ongoing Opportunity on this Sales Account. Give that Opportunity to someone else first, then try again.`
    )
  }
}

/**
 * Closes every PENDING request that matches `where`, auditing each. Used when
 * the Owner changes (CANCELLED: the new Owner is not bound by the old Owner's
 * request) and when a Sales Admin removes the person directly (APPROVED: the
 * removal the Owner asked for has happened).
 */
export async function closePendingRemovals(
  tx: Prisma.TransactionClient,
  where: Prisma.SalesCollaboratorRemovalWhereInput,
  status: "APPROVED" | "CANCELLED",
  actorSub: string
): Promise<number> {
  const pending = await tx.salesCollaboratorRemoval.findMany({
    where: { ...where, status: "PENDING" },
    select: { id: true },
  })
  if (pending.length === 0) return 0

  await tx.salesCollaboratorRemoval.updateMany({
    where: { id: { in: pending.map((row) => row.id) }, status: "PENDING" },
    data: { status, decidedBy: actorSub, decidedAt: new Date() },
  })
  for (const row of pending) {
    await writeAudit(tx, {
      entity: "SALES_COLLABORATOR_REMOVAL",
      entityId: row.id,
      action: status === "APPROVED" ? "APPROVE" : "CANCEL",
      changedBy: actorSub,
      before: { status: "PENDING" },
      after: { status },
    })
  }
  return pending.length
}
