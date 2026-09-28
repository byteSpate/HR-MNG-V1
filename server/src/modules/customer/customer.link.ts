/**
 * Spec §2: a Customer exists from the day the account's first deal is Won.
 * Called from opportunity.service.ts's changeOpportunityStatus, never
 * directly from a route — creating or linking a customer is a side effect
 * of winning a deal, not an action of its own.
 */

import type { Prisma } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"

export type EnsureMode = "skip-on-conflict" | "throw-on-conflict"

const SELECT = { id: true, legalName: true } as const

/**
 * Returns the account's Customer: already linked, or an unlinked Customer
 * with the same legal name (an opening-balance import created it before
 * this account ever won a deal — linked now rather than duplicated), or a
 * newly created one. When the name is already held by a Customer linked to
 * a *different* account, "skip-on-conflict" returns null (the Won still
 * goes through; Finance resolves the clash on Customers) and
 * "throw-on-conflict" (Task 6's customerPo.service, which cannot record a
 * PO with no customer) refuses with a 409 naming the fix.
 */
export async function ensureCustomerForAccount(
  tx: Prisma.TransactionClient,
  salesAccountId: string,
  mode: EnsureMode,
  actorUserId: string
) {
  const account = await tx.salesAccount.findUniqueOrThrow({
    where: { id: salesAccountId },
    select: { id: true, name: true, address: true, customer: { select: SELECT } },
  })
  if (account.customer) return account.customer

  const sameName = await tx.customer.findUnique({ where: { legalName: account.name } })
  if (sameName && sameName.salesAccountId === null) {
    const linked = await tx.customer.update({ where: { id: sameName.id }, data: { salesAccountId }, select: SELECT })
    await writeAudit(tx, {
      entity: "CUSTOMER", entityId: linked.id, action: "UPDATE", changedBy: actorUserId,
      after: { salesAccountId }, note: "Linked to its sales account when a deal was Won",
    })
    return linked
  }
  if (sameName) {
    if (mode === "skip-on-conflict") return null
    throw new AppError(
      409,
      `A customer called ${account.name} already belongs to another sales account. Rename one of them on Customers, then try again.`
    )
  }

  const created = await tx.customer.create({
    data: { legalName: account.name, billingAddress: account.address ?? null, salesAccountId },
    select: SELECT,
  })
  await writeAudit(tx, {
    entity: "CUSTOMER", entityId: created.id, action: "CREATE", changedBy: actorUserId,
    after: { legalName: created.legalName }, note: "Created when the account's deal was Won",
  })
  return created
}
