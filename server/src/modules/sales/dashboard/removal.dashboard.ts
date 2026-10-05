import prisma from "../../../config/prisma"
import { toneFor } from "../../dashboard/dashboard.tone"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { isSalesAdmin } from "../sales.access"
import type { SalesActionRow } from "../sales.types"

/**
 * "Collaborator removals to approve": a row on the Overview for a Sales Admin,
 * and the number on the Sales Settings menu item. Counted once, here, so the
 * card and the badge cannot disagree. Its href is `/settings`: that is where
 * the requests are listed.
 */
export async function removalActionRows(actor: AccessTokenPayload): Promise<SalesActionRow[]> {
  if (!isSalesAdmin(actor)) return []
  const waiting = await prisma.salesCollaboratorRemoval.count({ where: { status: "PENDING" } })
  return [
    {
      key: "removals",
      label: "Collaborator removals to approve",
      count: waiting,
      detail: waiting === 0 ? "Nothing is waiting" : "Owners are waiting for a Sales Admin",
      tone: toneFor.queue(waiting),
      href: "/settings",
    },
  ]
}
