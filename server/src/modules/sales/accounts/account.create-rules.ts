import { AppError } from "../../../middleware/errorHandler"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { isSalesAdmin } from "../sales.access"

export const NO_EMPLOYEE_RECORD = "You have no employee record, so you cannot own a Sales Account. Ask HR."
export const ONLY_FOR_YOURSELF =
  "You can only create a Sales Account for yourself. Ask a Sales Admin to create it for someone else."

/**
 * Who will own the Sales Account a caller is creating.
 *
 * A Sales Admin and the Super Admin pick any Owner, as before. A Sales User
 * (allowed by the `account.create` switch) is always the Owner themselves: no
 * Owner in the body means them, and naming anybody else is refused. Whether
 * that person may *be* an Owner (Sales User, still employed, login active) is
 * still checked by `loadEligibleOwner`, so there is one set of those sentences.
 */
export function resolveCreateOwner(
  ownerEmployeeId: string | undefined,
  actor: AccessTokenPayload,
  actorEmployeeId: string | null
): string {
  if (isSalesAdmin(actor)) {
    if (!ownerEmployeeId) throw new AppError(400, "Choose an owner")
    return ownerEmployeeId
  }
  if (!actorEmployeeId) throw new AppError(403, NO_EMPLOYEE_RECORD)
  if (ownerEmployeeId && ownerEmployeeId !== actorEmployeeId) throw new AppError(403, ONLY_FOR_YOURSELF)
  return actorEmployeeId
}
