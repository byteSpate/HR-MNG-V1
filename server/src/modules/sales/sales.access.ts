import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
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
 * "Which accounts are *literally* this person's?" — owner or assignee, with
 * no admin bypass.
 *
 * Deliberately not `accountScopeFor`. That one answers a permission question
 * ("what may they reach?") and so hands an admin everything, which is right
 * for a write gate and wrong for a list called "My Accounts": it made that
 * page an exact copy of "All Accounts" for every admin, and told a Super
 * Admin that two accounts they had never touched were theirs.
 *
 * A caller with no Employee row owns nothing and is assigned to nothing, so
 * the honest answer for them is the empty set rather than everything.
 */
export function ownedScopeFor(employeeId: string | null): Prisma.SalesAccountWhereInput {
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

/**
 * Said once, so the list, the detail page and every child resource refuse in
 * the same words.
 */
export const ACCOUNT_NOT_VISIBLE = "That Sales Account does not exist, or is not yours"

/**
 * "May this person touch this account?" — the WRITE gate, answered once for
 * everything that hangs off one: adding a contact, promoting or verifying
 * one, logging a communication. Owner, assignee or admin only.
 *
 * 404 and not 403, matching `getSalesAccount`: a 403 would confirm that an
 * account exists to somebody who is not allowed to know that it does.
 *
 * Returns the account's owner and the caller's own employee id alongside.
 * Both have just been fetched, and the writes that follow need them: the
 * owner is who an event about this account is for, and the caller is the
 * author of anything they write on it.
 */
export async function requireAccountAccess(
  accountId: string,
  actor: AccessTokenPayload
): Promise<{ accountId: string; ownerEmployeeId: string; employeeId: string | null }> {
  const employeeId = await employeeIdFor(actor)
  const account = await prisma.salesAccount.findFirst({
    where: { AND: [{ id: accountId }, accountScopeFor(actor, employeeId)] },
    select: { id: true, ownerEmployeeId: true },
  })
  if (!account) {
    throw new AppError(404, ACCOUNT_NOT_VISIBLE)
  }
  return { accountId: account.id, ownerEmployeeId: account.ownerEmployeeId, employeeId }
}

/**
 * "May this person see this account at all?" — the READ gate, deliberately
 * permissive: any Sales Hub member may view any account, its contacts, its
 * timeline and its history. `requireSales` already confirmed hub membership
 * at the route; this only confirms the account itself is real.
 *
 * The directory is shared on purpose — "All Accounts" would be pointless if
 * opening a row you don't manage 404s. Ownership and assignment stay a
 * WRITE gate (`requireAccountAccess` above), not a visibility one.
 */
export async function requireAccountVisible(
  accountId: string,
  _actor: AccessTokenPayload
): Promise<{ accountId: string; ownerEmployeeId: string }> {
  const account = await prisma.salesAccount.findUnique({
    where: { id: accountId },
    select: { id: true, ownerEmployeeId: true },
  })
  if (!account) {
    throw new AppError(404, ACCOUNT_NOT_VISIBLE)
  }
  return { accountId: account.id, ownerEmployeeId: account.ownerEmployeeId }
}

/**
 * Whether `employeeId` may write to an account with this owner and these
 * assignees. The one place this rule is spelled out, so a list row's "can
 * manage" badge and every write endpoint's actual refusal can never drift
 * apart from each other.
 */
export function canManageAccount(
  actor: AccessTokenPayload,
  employeeId: string | null,
  ownerEmployeeId: string,
  assigneeIds: string[]
): boolean {
  const isAdmin = actor.role === Role.SUPER_ADMIN || actor.salesRole === SalesRole.SALES_ADMIN
  if (isAdmin) return true
  if (!employeeId) return false
  return employeeId === ownerEmployeeId || assigneeIds.includes(employeeId)
}
