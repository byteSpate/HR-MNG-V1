/**
 * What the funnel accepts from a request (revision §27).
 *
 * Its own file, not more lines in `sales.validators.ts`. That one is already
 * 452 lines and grows with every phase because it belongs to no feature
 * (§28); the funnel does not add to it (§27.18).
 */

import { z } from "zod"

/** Date-only, the house wire format. */
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in YYYY-MM-DD form")

/** Up to two decimal places, and no more than the column holds. */
const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "Use an amount like 35536.00")

/** The four filters and five sorts the grid offers (§27.9). */
export const funnelQuerySchema = z.object({
  /** Whose funnel. Absent means the caller's own. */
  employeeId: z.string().uuid().optional(),
  status: z.enum(["ONGOING", "WON", "LOST", "CANCELLED"]).optional(),
  salesAccountId: z.string().uuid().optional(),
  /** Drop Lost and Cancelled from the grid entirely. */
  hideClosed: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  /** Only deals touched in the last seven days. */
  changedLastWeek: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  /** Given to employees as well as admins (§27.9). */
  sort: z
    .enum(["offeredOn", "status", "amount", "expectedCloseDate", "account"])
    .optional()
    .default("offeredOn"),
  direction: z.enum(["asc", "desc"]).optional().default("desc"),
  /**
   * Bounded on purpose. The funnel is a running list that only grows, and an
   * unbounded read is exactly the defect the performance audit found in 191
   * other places.
   */
  limit: z.coerce.number().int().min(1).max(500).optional().default(200),
})

export type FunnelQuery = z.infer<typeof funnelQuerySchema>

/**
 * One cell, edited in place (§27.7).
 *
 * A closed list of fields rather than a free-form patch: this writes to the
 * real deal, so what the grid may change is a decision, not whatever the
 * client happens to send.
 *
 * `status` is absent on purpose. Changing a deal's status has its own rules —
 * a reason is required, `closedAt` is stamped, the winner is frozen — and they
 * live in `opportunity.service.ts`. The grid links to that rather than
 * reimplementing it badly.
 */
export const editFunnelCellSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("useCase"), value: z.string().trim().max(200).nullable() }),
  z.object({ field: z.literal("offeredOn"), value: dateOnly.nullable() }),
  z.object({ field: z.literal("expectedCloseDate"), value: dateOnly.nullable() }),
  z.object({ field: z.literal("amount"), value: money.nullable() }),
  z.object({ field: z.literal("nextStep"), value: z.string().trim().max(500).nullable() }),
  z.object({ field: z.literal("lostToPartner"), value: z.string().trim().max(200).nullable() }),
  z.object({ field: z.literal("lostToAmount"), value: money.nullable() }),
  z.object({ field: z.literal("lostToProduct"), value: z.string().trim().max(200).nullable() }),
])

export type EditFunnelCell = z.infer<typeof editFunnelCellSchema>

/** The body of a cell edit, with the meeting it was made in if there was one. */
export const editFunnelCellBodySchema = z.object({
  opportunityId: z.string().uuid(),
  edit: editFunnelCellSchema,
  /**
   * Set when the edit is made from inside a Saturday review, so the audit row
   * can name the meeting and the Timeline can say where the change came from
   * (§27.7).
   */
  funnelMeetingId: z.string().uuid().nullable().optional(),
})

/** Opening the Saturday review (§27.11). */
export const openMeetingSchema = z.object({
  /** The Sunday of the week under review. Defaults to the last finished week. */
  weekStart: dateOnly.optional(),
  /** The day it is actually held. Defaults to today. */
  heldOn: dateOnly.optional(),
})

export const meetingAttendeesSchema = z.object({
  employeeIds: z.array(z.string().uuid()).max(100),
})

export const reviewPersonSchema = z.object({
  employeeId: z.string().uuid(),
  /** False takes the tick back off, for the person ticked by mistake. */
  reviewed: z.boolean(),
})

export const meetingNoteSchema = z.object({
  note: z.string().trim().max(4000).nullable(),
})

/**
 * A management note on a deal, written during the review (§27.8, §27.12).
 * Admin only, and it lands as an ordinary `SalesComment` carrying the meeting.
 */
export const managementNoteSchema = z.object({
  opportunityId: z.string().uuid(),
  body: z.string().trim().min(1, "Write something").max(4000),
})

/**
 * An action item (§27.13): the first task in this system that one person
 * gives another.
 */
export const funnelActionSchema = z.object({
  assignedToEmployeeId: z.string().uuid(),
  title: z.string().trim().min(1, "Give it a title").max(200),
  detail: z.string().trim().max(2000).nullable().optional(),
  /** Defaults to the next Saturday when absent (§27.13). */
  dueOn: dateOnly.optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH"]).optional().default("NORMAL"),
  salesAccountId: z.string().uuid().nullable().optional(),
  opportunityId: z.string().uuid().nullable().optional(),
})
