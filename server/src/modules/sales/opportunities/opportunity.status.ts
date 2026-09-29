import prisma from "../../../config/prisma"
import type { Prisma } from "../../../generated/prisma/client"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { emitEvent } from "../../event/event.emit"
import { ensureCustomerForAccount } from "../../customer/customer.link"
import { isSalesAdmin } from "../sales.access"
import { INCLUDE, loadForWrite, STATUS_WORD } from "./opportunity.service"
import { presentOpportunity } from "./opportunity.present"
import type { CorrectOpportunityStatusBody } from "./opportunity.validators"

export const MONEY_OR_PROJECT =
  "This Opportunity has money or a Project on it, so its status cannot be changed. Ask Finance for help."

/**
 * Money or a live Project pins an Opportunity's status. A cancelled PO and a
 * cancelled Project leave nothing behind, so they do not count. Receipts and
 * supplier payments need an invoice or a bill first, so POs and bills cover them.
 */
export async function hasMoneyOrLiveProject(tx: Prisma.TransactionClient, opportunityId: string): Promise<boolean> {
  const [pos, bills, projects] = await Promise.all([
    tx.customerPo.count({ where: { opportunityId, status: { not: "CANCELLED" } } }),
    tx.supplierBill.count({ where: { opportunityId } }),
    tx.project.count({ where: { opportunityId, status: { not: "CANCELLED" } } }),
  ])
  return pos > 0 || bills > 0 || projects > 0
}

/**
 * Fixing a status set by mistake (spec 2026-09-28 §1.4). Won, Lost and
 * Cancelled are final for everyone on the normal route; this is the one way
 * back, for a Sales Admin or the Super Admin, with a reason kept in History.
 */
export async function correctOpportunityStatus(id: string, body: CorrectOpportunityStatusBody, actor: AccessTokenPayload) {
  if (!isSalesAdmin(actor)) throw new AppError(403, "Only a Sales Admin or the Super Admin can correct a status.")
  return prisma.$transaction(async (tx) => {
    const current = await loadForWrite(tx, id, actor)
    if (current.status === "ONGOING") {
      throw new AppError(409, "This Opportunity is still open. Use Mark Won, Mark Lost or Mark Cancelled.")
    }
    if (current.status === body.status) return presentOpportunity(current)
    if (await hasMoneyOrLiveProject(tx, id)) throw new AppError(409, MONEY_OR_PROJECT)
    if (body.status === "WON") {
      const missing = current.lines.filter((l) => !l.supplierId).map((l) => l.product)
      if (missing.length > 0) {
        throw new AppError(400, `Pick a supplier for every product before marking this Opportunity won. Missing: ${missing.join(", ")}.`)
      }
    }
    const reason = body.reason.trim()
    const data: Prisma.OpportunityUpdateInput = {
      status: body.status,
      lastActivityAt: new Date(),
      statusReason: body.status === "LOST" || body.status === "CANCELLED" ? reason : null,
      // Closed to closed keeps the day it really closed. Back to Ongoing clears it.
      ...(body.status === "ONGOING" ? { closedAt: null } : {}),
      // Credit is stamped once and never moves (CONTEXT.md, Credit).
      ...(body.status === "WON" && current.wonByEmployeeId === null
        ? { wonBy: { connect: { id: current.ownerEmployeeId } } } : {}),
    }
    const updated = await tx.opportunity.update({ where: { id }, data, include: INCLUDE })
    if (body.status === "WON") await ensureCustomerForAccount(tx, current.salesAccountId, "skip-on-conflict", actor.sub)
    await writeAudit(tx, {
      entity: "OPPORTUNITY", entityId: id, action: "UPDATE", changedBy: actor.sub,
      before: { status: current.status }, after: { status: body.status }, note: `Corrected: ${reason}`,
    })
    await emitEvent(tx, {
      type: "sales.opportunity.status_corrected", entity: "OPPORTUNITY", entityId: id,
      actorUserId: actor.sub, subjectEmployeeId: current.ownerEmployeeId, managerEmployeeId: null,
      title: `${current.serial} corrected from ${STATUS_WORD[current.status]} to ${STATUS_WORD[body.status]}`,
      meta: reason, href: `/opportunities/${id}`,
    })
    return presentOpportunity(updated)
  })
}
