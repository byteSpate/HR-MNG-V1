/**
 * A management note on a deal, written during the review (revision §27.8,
 * §27.12).
 *
 * It lands as an ordinary `SalesComment` carrying the meeting, so it shows in
 * the deal's remarks and on its Timeline without a second store — and it is
 * written the way `comment.service.ts` writes one: in a transaction, with the
 * author's employee row, and with an audit row for the creation.
 */

import prisma from "../../../config/prisma"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { employeeIdFor, isSalesAdmin } from "../sales.access"
import { ADMIN_ONLY, lockMeeting } from "./funnel.meeting"

export const NOTE_DEAL_MISSING = "That deal does not exist"
export const NOTE_NOT_QUOTED = "That deal has not been quoted, so it is not in the funnel"

export async function addManagementNote(
  meetingId: string,
  body: { opportunityId: string; body: string },
  actor: AccessTokenPayload
): Promise<{ id: string; createdAt: string }> {
  if (!isSalesAdmin(actor)) throw new AppError(403, ADMIN_ONLY)

  return prisma.$transaction(async (tx) => {
    // Locked, so completing the meeting cannot slip in between the check and
    // the write and leave a note on a meeting that has just been closed.
    await lockMeeting(tx, meetingId, { open: true })

    const deal = await tx.opportunity.findUnique({
      where: { id: body.opportunityId },
      select: { id: true, offeredOn: true },
    })
    if (!deal) throw new AppError(404, NOTE_DEAL_MISSING)
    if (!deal.offeredOn) throw new AppError(409, NOTE_NOT_QUOTED)

    const authorEmployeeId = await employeeIdFor(actor, tx as never)

    const created = await tx.salesComment.create({
      data: {
        entity: "OPPORTUNITY",
        entityId: body.opportunityId,
        kind: "MANAGEMENT_NOTE",
        body: body.body,
        authorUserId: actor.sub,
        // Without this the remark is signed with the admin's sign-in address
        // rather than their name.
        authorEmployeeId,
        funnelMeetingId: meetingId,
      },
      select: { id: true, createdAt: true },
    })

    await writeAudit(tx, {
      entity: "SALES_COMMENT",
      entityId: created.id,
      action: "CREATE",
      changedBy: actor.sub,
      after: {
        entity: "OPPORTUNITY",
        entityId: body.opportunityId,
        kind: "MANAGEMENT_NOTE",
        body: body.body,
        funnelMeetingId: meetingId,
      },
      note: "Written at a funnel meeting",
    })

    return { id: created.id, createdAt: created.createdAt.toISOString() }
  })
}
