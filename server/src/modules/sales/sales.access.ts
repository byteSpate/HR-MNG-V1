import prisma from "../../config/prisma"
import { Role, SalesRole } from "../../generated/prisma/client"
import type { Prisma } from "../../generated/prisma/client"
import type { AccessTokenPayload } from "../auth/auth.types"

/**
 * One place that answers "which Sales Accounts may this person see?", so the
 * rule cannot drift between the list, the detail page and every child
 * resource that hangs off an account.
 *
 * An admin sees everything. Everyone else sees what they own or are assigned
 * to. Pure — the user-to-employee lookup is `employeeIdFor` below, kept out
 * of here so this stays trivially testable with no database.
 */
export function accountScopeFor(
  actor: AccessTokenPayload,
  employeeId: string | null
): Prisma.SalesAccountWhereInput {
  const isAdmin = actor.role === Role.SUPER_ADMIN || actor.salesRole === SalesRole.SALES_ADMIN
  if (isAdmin) return {}
  // No Employee row means nothing to own or be assigned to. A Super Admin has
  // already returned above, so this is the HR Admin granted SALES_USER, and
  // matching nothing is the honest answer — falling through to `{}` here
  // would hand them every account because a row was missing.
  if (!employeeId) return { id: "__none__" }
  return {
    OR: [{ ownerEmployeeId: employeeId }, { assignments: { some: { employeeId } } }],
  }
}

/**
 * The JWT carries `sub`, a *user* id. Accounts are owned by and assigned to
 * *employees*. One lookup bridges them.
 *
 * Null for an account with no Employee row — Super Admin and HR Admin are
 * seeded that way. This is the only query in the access path; `requireSales`
 * itself stays a zero-query check.
 */
export async function employeeIdFor(actor: AccessTokenPayload): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: actor.sub },
    select: { employee: { select: { id: true } } },
  })
  return user?.employee?.id ?? null
}
