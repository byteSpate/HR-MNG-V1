/**
 * Editing a funnel cell (revision §27.7).
 *
 * **Every edit writes to the real deal.** There is one record of an
 * opportunity and the funnel is a view onto it, so nothing here keeps a copy
 * that could drift.
 *
 * An edit made during a Saturday review carries the meeting, and the audit row
 * says so. That is what makes "who changed the amount, and why" answerable a
 * month later, without a column on the deal recording where it came from.
 */

import prisma from "../../../config/prisma"
import { Prisma } from "../../../generated/prisma/client"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import { parseDateOnly } from "../../../utils/dates"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { emitEvent } from "../../event/event.emit"
import { accountScopeFor, employeeIdFor, isSalesAdmin, OPPORTUNITY_NOT_VISIBLE } from "../sales.access"
import type { EditFunnelCell } from "./funnel.validators"

export const MEETING_NOT_OPEN = "That funnel meeting is not open"
export const MEETING_ADMIN_ONLY = "Only a Sales Admin can make a change on behalf of a funnel meeting"
export const OFFER_DATE_REQUIRED = "A quoted deal keeps its offer date. Change it, but it cannot be cleared"

/** The columns the grid may write. */
type Writable = EditFunnelCell["field"]

const DATE_FIELDS = new Set<Writable>(["offeredOn", "expectedCloseDate"])
const MONEY_FIELDS = new Set<Writable>(["amount", "lostToAmount"])

/**
 * Turns the validated wire value into what Prisma stores.
 *
 * An empty string becomes null, not an empty string: clearing a cell means
 * "there is no answer", and storing "" would show a blank that no filter
 * could ever find.
 */
function toColumn(field: Writable, value: string | null): Date | string | Prisma.Decimal | null {
  if (value === null || value === "") return null
  if (DATE_FIELDS.has(field)) return parseDateOnly(value)
  if (MONEY_FIELDS.has(field)) return new Prisma.Decimal(value)
  return value
}

/**
 * What the audit row records. An ISO string either way, so the closing-date
 * reader in `funnel.service.ts` can compare two of them without guessing at a
 * format.
 */
function forAudit(value: Date | string | Prisma.Decimal | null): string | null {
  if (value === null) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

/**
 * Whether a save would leave the cell as it is. Money is compared as a number,
 * because `100.00` typed into a cell and `100` read back from a Decimal column
 * are the same amount, and neither should write an audit row.
 */
function unchanged(
  field: Writable,
  before: Date | string | Prisma.Decimal | null,
  next: Date | string | Prisma.Decimal | null
): boolean {
  if (before === null || next === null) return before === next
  if (MONEY_FIELDS.has(field)) return new Prisma.Decimal(before as never).equals(next as never)
  return forAudit(before) === forAudit(next)
}

const LABEL: Record<Writable, string> = {
  useCase: "use case",
  offeredOn: "offer date",
  expectedCloseDate: "closing date",
  amount: "amount",
  nextStep: "next step",
  lostToPartner: "lost-to partner",
  lostToAmount: "lost-to amount",
  lostToProduct: "lost-to product",
}

export interface EditFunnelCellInput {
  opportunityId: string
  edit: EditFunnelCell
  funnelMeetingId?: string | null
}

/**
 * Writes one field of one deal.
 *
 * Access is the account's own rule (`accountScopeFor`) — the funnel invents no
 * permission of its own for deal facts (§27.12). Somebody who may work the
 * account may fix a figure on it, whether or not a meeting is running.
 */
export async function editFunnelCell(
  input: EditFunnelCellInput,
  actor: AccessTokenPayload
): Promise<{ opportunityId: string; field: Writable; value: string | null }> {
  const { opportunityId, edit } = input

  // Belt and braces with the validator: membership is `offeredOn` being set
  // (§27.2), so nothing that reaches this function may take it off.
  if (edit.field === "offeredOn" && (edit.value === null || edit.value === "")) {
    throw new AppError(400, OFFER_DATE_REQUIRED)
  }
  // Attributing a change to a meeting is the review's own act. A Sales User
  // holding a meeting's id must not be able to stamp their edits as having
  // been made in it.
  if (input.funnelMeetingId && !isSalesAdmin(actor)) {
    throw new AppError(403, MEETING_ADMIN_ONLY)
  }

  return prisma.$transaction(async (tx) => {
    const employeeId = await employeeIdFor(actor, tx as never)
    const current = await tx.opportunity.findFirst({
      where: { AND: [{ id: opportunityId }, { salesAccount: accountScopeFor(actor, employeeId) }] },
      select: {
        id: true,
        serial: true,
        salesAccountId: true,
        ownerEmployeeId: true,
        useCase: true,
        offeredOn: true,
        expectedCloseDate: true,
        amount: true,
        nextStep: true,
        lostToPartner: true,
        lostToAmount: true,
        lostToProduct: true,
      },
    })
    if (!current) throw new AppError(404, OPPORTUNITY_NOT_VISIBLE)

    // A meeting named on the edit must exist and still be open. Attributing a
    // change to a meeting that was never held is a false record, and a
    // completed meeting takes no new work (§27.11).
    let meetingNote: string | null = null
    if (input.funnelMeetingId) {
      const meeting = await tx.funnelMeeting.findUnique({
        where: { id: input.funnelMeetingId },
        select: { id: true, status: true, heldOn: true },
      })
      if (!meeting || meeting.status !== "SCHEDULED") throw new AppError(409, MEETING_NOT_OPEN)
      meetingNote = `Changed in the funnel meeting of ${meeting.heldOn.toISOString().slice(0, 10)}`
    }

    const next = toColumn(edit.field, edit.value)
    const before = current[edit.field] as Date | string | Prisma.Decimal | null

    // Saving what is already there changes nothing, so it writes nothing: no
    // audit row, no Timeline entry, no "changed" bump to the activity clock
    // that "quiet" and "changed in the last week" both read.
    if (unchanged(edit.field, before, next)) {
      return { opportunityId, field: edit.field, value: edit.value }
    }

    await tx.opportunity.update({
      where: { id: opportunityId },
      data: { [edit.field]: next, lastActivityAt: new Date() },
    })

    await writeAudit(tx, {
      entity: "OPPORTUNITY",
      entityId: opportunityId,
      action: "UPDATE",
      changedBy: actor.sub,
      before: { [edit.field]: forAudit(before) } as Prisma.InputJsonObject,
      after: { [edit.field]: forAudit(next) } as Prisma.InputJsonObject,
      note: meetingNote,
    })

    // Worded as coming from the funnel meeting when it did (§27.7), so the
    // account Timeline reads as the story it actually was.
    await emitEvent(tx, {
      type: "sales.funnel.cell_changed",
      entity: "OPPORTUNITY",
      entityId: opportunityId,
      actorUserId: actor.sub,
      subjectEmployeeId: current.ownerEmployeeId,
      managerEmployeeId: null,
      title: meetingNote
        ? `${current.serial} ${LABEL[edit.field]} changed in the funnel meeting`
        : `${current.serial} ${LABEL[edit.field]} changed in the funnel`,
      meta: null,
      href: `/opportunities/${opportunityId}`,
    })

    return { opportunityId, field: edit.field, value: edit.value }
  })
}

/**
 * The stages at which a quotation has gone out: Quotation submitted and the
 * two that can only follow it.
 *
 * A stage change is free-form — nothing forces a deal through Quotation
 * submitted on its way to Negotiation — so the stamp cannot key on that one
 * stage alone. A deal moved straight to Negotiation has been quoted as far as
 * anybody can tell, and would otherwise never enter the funnel.
 */
const QUOTED_STAGES: ReadonlySet<string> = new Set([
  "QUOTATION_SUBMITTED",
  "NEGOTIATION",
  "AWAITING_DECISION",
])

/**
 * Stamps the offer date the first time a deal reaches a quoted stage (§27.4),
 * which is also the moment it joins the funnel (§27.2).
 *
 * Only ever fills a blank. A deal that drops back to an earlier stage and
 * comes forward again keeps the date it was really quoted on, and a date
 * somebody has corrected by hand is never overwritten.
 */
export async function stampOfferedOn(
  tx: Prisma.TransactionClient,
  opportunityId: string,
  stage: string,
  currentOfferedOn: Date | null,
  today: Date
): Promise<boolean> {
  if (!QUOTED_STAGES.has(stage)) return false
  if (currentOfferedOn) return false

  await tx.opportunity.update({
    where: { id: opportunityId },
    data: { offeredOn: today },
  })
  return true
}
