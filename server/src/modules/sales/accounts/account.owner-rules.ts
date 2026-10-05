import { AppError } from "../../../middleware/errorHandler"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { isSalesAdmin } from "../sales.access"

export const MAY_NOT_CHANGE_OWNER = "Only the Owner or a Sales Admin can give this Sales Account to someone else."
export const OWNER_TO_COLLABORATOR_ONLY =
  "You can give this Sales Account only to one of its collaborators. To give it to someone else, ask a Sales Admin."

/**
 * Who may change a Sales Account's Owner, and to whom.
 *
 * Before this, any collaborator could. Now only the current Owner or a Sales
 * Admin can, and an Owner who is a Sales User can give it only to one of the
 * Sales Account's own collaborators. A Sales Admin can give it to any eligible
 * Sales User, which is also how an orphaned Sales Account is fixed. Whether the
 * new Owner is eligible is still `loadEligibleOwner`'s job.
 *
 * This is a rule, not a Permission switch, and it applies with every switch at
 * its default.
 */
export function assertMayChangeOwner(args: {
  actor: AccessTokenPayload
  actorEmployeeId: string | null
  currentOwnerId: string
  collaboratorIds: string[]
  nextOwnerId: string
}): void {
  if (isSalesAdmin(args.actor)) return
  if (args.actorEmployeeId === null || args.actorEmployeeId !== args.currentOwnerId) {
    throw new AppError(403, MAY_NOT_CHANGE_OWNER)
  }
  if (!args.collaboratorIds.includes(args.nextOwnerId)) {
    throw new AppError(403, OWNER_TO_COLLABORATOR_ONLY)
  }
}

/**
 * The Owner of the Sales Account, or a Sales Admin. The same question several
 * collaborator rules ask, so it is said once.
 */
export function assertOwnerOrAdmin(
  actor: AccessTokenPayload,
  actorEmployeeId: string | null,
  ownerEmployeeId: string,
  message: string
): void {
  if (isSalesAdmin(actor)) return
  if (actorEmployeeId === null || actorEmployeeId !== ownerEmployeeId) throw new AppError(403, message)
}
