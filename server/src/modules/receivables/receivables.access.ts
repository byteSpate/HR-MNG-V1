import { Role } from "../../generated/prisma/client"
import type { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { accountScopeFor, employeeIdFor } from "../sales/sales.access"
import type { AccessTokenPayload } from "../auth/auth.types"

export function isFinance(actor: AccessTokenPayload): boolean {
  return actor.role === Role.FINANCE_OFFICER || actor.role === Role.SUPER_ADMIN
}

/**
 * Finance and Super Admin reach any deal. A sales user reaches a deal on an
 * account they own or are assigned to, the same rule the Sales Hub itself
 * uses (sales.access.accountScopeFor). Everyone else is refused before the
 * deal is even read, so a 403 never leaks whether the id exists.
 */
export async function assertDealAccess(
  client: Prisma.TransactionClient | typeof prisma,
  actor: AccessTokenPayload,
  opportunityId: string
) {
  if (!isFinance(actor) && !actor.salesRole) throw new AppError(403, "You do not have access to this deal")

  const deal = await client.opportunity.findUnique({
    where: { id: opportunityId },
    select: { id: true, serial: true, status: true, salesAccountId: true },
  })
  if (!deal) throw new AppError(404, "Deal not found")
  if (isFinance(actor)) return deal

  const scope = accountScopeFor(actor, await employeeIdFor(actor))
  const visible = await client.salesAccount.count({ where: { AND: [{ id: deal.salesAccountId }, scope] } })
  if (visible === 0) throw new AppError(403, "You do not have access to this deal")
  return deal
}
