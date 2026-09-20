import { z } from "zod"

import { sectionInputSchema } from "./minutes.content"
import { dateOnly, money } from "./sales.primitives"

export const createSalesAccountSchema = z.object({
  name: z.string().trim().min(2, "A Sales Account needs a name").max(160),
  ownerEmployeeId: z.string().uuid("Choose an owner"),
  industry: z.string().trim().max(120).optional(),
  website: z.string().trim().max(200).optional(),
  address: z.string().trim().max(400).optional(),
  /** The extra people. The owner is ignored if it appears here. */
  assigneeIds: z.array(z.string().uuid()).max(20).optional(),
})

export type CreateSalesAccountBody = z.infer<typeof createSalesAccountSchema>

/**
 * Editing an account. Every field optional, because the form sends only what
 * changed — but not *all* optional: a body with nothing in it is a mistake
 * worth naming rather than a silent 200 that changed nothing.
 *
 * `industry`, `website` and `address` are nullable as well as optional, and
 * the two mean different things: absent leaves the value alone, null clears
 * it. Without that distinction there is no way to remove a website once one
 * has been typed.
 *
 * `statusReason` is deliberately *not* conditionally required here. Whether a
 * reason is needed depends on the status the account is moving to, and that
 * rule lives in the service beside the status change itself — the same place
 * owner eligibility is enforced, and for the same reason: the service is the
 * boundary, not the schema.
 */
export const updateSalesAccountSchema = z
  .object({
    name: z.string().trim().min(2, "A Sales Account needs a name").max(160).optional(),
    ownerEmployeeId: z.string().uuid("Choose an owner").optional(),
    industry: z.string().trim().max(120).nullable().optional(),
    website: z.string().trim().max(200).nullable().optional(),
    address: z.string().trim().max(400).nullable().optional(),
    status: z.enum(["ACTIVE", "INACTIVE", "DO_NOT_CONTACT"]).optional(),
    statusReason: z.string().trim().max(400).nullable().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Nothing was changed",
  })

export type UpdateSalesAccountBody = z.infer<typeof updateSalesAccountSchema>

export const createSalesContactSchema = z
  .object({
    name: z.string().trim().min(2, "A contact needs a name").max(160),
    designation: z.string().trim().max(120).optional(),
    // Individually optional, but the refine below requires at least one.
    // Which one exists varies — a switchboard number with no personal
    // address, or an email off a tender document with no direct line — so
    // neither can be mandatory on its own.
    phone: z.string().trim().max(32).optional(),
    email: z.string().trim().email("That is not an email address").toLowerCase().optional(),
    note: z.string().trim().max(500).optional(),
  })
  // A contact nobody can contact is just a name in a list. The previous
  // version allowed it, reasoning that "we know a procurement head exists but
  // have no number yet" is a real state — it is, but it belongs in the note,
  // not as a contact row every later screen has to treat as unreachable.
  //
  // Existing rows are untouched: the column stays nullable, so contacts
  // created before this rule still load.
  .refine((body) => Boolean(body.phone) || Boolean(body.email), {
    message: "Add a phone number or an email — a contact needs at least one way to reach them",
    path: ["phone"],
  })

export type CreateSalesContactBody = z.infer<typeof createSalesContactSchema>

export const setContactStatusSchema = z.object({
  status: z.enum(["UNVERIFIED", "VERIFIED", "UNREACHABLE", "INVALID"]),
  /** Goes on the audit row, not over the contact's own note. */
  note: z.string().trim().max(500).optional(),
})

export type SetContactStatusBody = z.infer<typeof setContactStatusSchema>

export const logCommunicationSchema = z.object({
  channel: z.enum(["CALL", "EMAIL", "WHATSAPP", "OTHER"]),
  /** ISO 8601. The service refuses one in the future. */
  occurredAt: z.string().datetime({ offset: true }),
  summary: z.string().trim().min(2, "Say what happened").max(300),
  detail: z.string().trim().max(4000).optional(),
  /** Optional: plenty of calls are to a switchboard rather than a person. */
  contactId: z.string().uuid().optional(),
})

export type LogCommunicationBody = z.infer<typeof logCommunicationSchema>

// ── meetings (phase 3, revision §24) ─────────────────────────────────────────
const meetingMode = z.enum(["CUSTOMER_SITE", "OUR_OFFICE", "ONLINE"])
const instant = z.string().datetime({ offset: true })

/** Our side is an employee; their side is a saved contact, or a typed name. */
const meetingAttendeeSchema = z
  .object({
    side: z.enum(["OURS", "THEIRS"]),
    employeeId: z.string().uuid().optional(),
    contactId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(120).optional(),
    designation: z.string().trim().max(120).optional(),
  })
  .refine((a) => (a.side === "OURS" ? !!a.employeeId : !!a.contactId || !!a.name), {
    message: "Somebody on our side is an employee; somebody on theirs is a saved contact or a name",
  })

export const createMeetingSchema = z.object({
  salesAccountId: z.string().uuid(),
  opportunityId: z.string().uuid().optional(),
  title: z.string().trim().min(2, "Give the meeting a title").max(180),
  // A visit is the usual meeting, so it is the default.
  mode: meetingMode.default("CUSTOMER_SITE"),
  scheduledAt: instant,
  endsAt: instant.optional(),
  location: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(4000).optional(),
  attendees: z.array(meetingAttendeeSchema).max(50).default([]),
})

export const updateMeetingSchema = z
  .object({
    opportunityId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(2, "Give the meeting a title").max(180).optional(),
    mode: meetingMode.optional(),
    scheduledAt: instant.optional(),
    endsAt: instant.nullable().optional(),
    location: z.string().trim().max(500).nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    attendees: z.array(meetingAttendeeSchema).max(50).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing was changed" })

export const changeMeetingStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("COMPLETED"), outcome: z.string().trim().max(2000).optional() }),
  z.object({
    status: z.literal("CANCELLED"),
    reason: z.string().trim().min(2, "Say why the meeting is cancelled").max(500),
  }),
  z.object({ status: z.literal("SCHEDULED") }),
])

export const listMeetingSchema = z.object({
  salesAccountId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().optional(),
  status: z.enum(["SCHEDULED", "COMPLETED", "CANCELLED"]).optional(),
  mine: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === "true" ? true : undefined)),
  from: instant.optional(),
  to: instant.optional(),
})

export type CreateMeetingBody = z.infer<typeof createMeetingSchema>
export type UpdateMeetingBody = z.infer<typeof updateMeetingSchema>
export type ChangeMeetingStatusBody = z.infer<typeof changeMeetingStatusSchema>
export type ListMeetingQuery = z.infer<typeof listMeetingSchema>

// The profit on a deal, as a percentage of its value. Negative is a deal sold
// at a loss; beyond 100 either way is a typing mistake, not a margin.
const marginPercent = z
  .string()
  .regex(/^-?\d{1,3}(\.\d{1,2})?$/, "Enter the margin as a percentage with up to two decimal places, like 12.5")
  .refine((value) => Math.abs(Number(value)) <= 100, "A margin is between -100% and 100%")
const opportunityStage = z.enum([
  "REQUIREMENT_RECEIVED", "SOLUTION_DESIGN", "OEM_PRICING",
  "QUOTATION_SUBMITTED", "NEGOTIATION", "AWAITING_DECISION",
])
const opportunityStatus = z.enum(["ONGOING", "WON", "LOST", "CANCELLED"])

export const createOpportunitySchema = z.object({
  salesAccountId: z.string().uuid(),
  name: z.string().trim().min(2, "An Opportunity needs a name").max(180),
  track: z.enum(["NETWORKING"]),
  amount: money.optional(),
  expectedCloseDate: dateOnly.optional(),
  oemAccountManager: z.string().trim().max(160).optional(),
  ownerEmployeeId: z.string().uuid().optional(),
  addAssignment: z.boolean().optional(),
  /** The meeting it came out of, when made from that meeting's minutes (revision §25.6). */
  meetingId: z.string().uuid().optional(),
})
export type CreateOpportunityBody = z.infer<typeof createOpportunitySchema>

export const listOpportunitySchema = z.object({
  status: opportunityStatus.optional(),
  stage: opportunityStage.optional(),
  salesAccountId: z.string().uuid().optional(),
  ownerEmployeeId: z.string().uuid().optional(),
  mine: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  closing: z.coerce.number().int().min(1).max(365).optional(),
  quiet: z.coerce.number().int().min(1).max(365).optional(),
  stuck: z.coerce.number().int().min(1).max(365).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})
export type ListOpportunityQuery = z.infer<typeof listOpportunitySchema>

export const updateOpportunitySchema = z.object({
  name: z.string().trim().min(2).max(180).optional(),
  track: z.enum(["NETWORKING"]).optional(),
  amount: money.nullable().optional(),
  expectedCloseDate: dateOnly.nullable().optional(),
  oemAccountManager: z.string().trim().max(160).nullable().optional(),
  ownerEmployeeId: z.string().uuid().optional(),
  addAssignment: z.boolean().optional(),
}).refine((body) => Object.keys(body).some((key) => key !== "addAssignment"), { message: "Nothing was changed" })
export type UpdateOpportunityBody = z.infer<typeof updateOpportunitySchema>

export const changeOpportunityStageSchema = z.object({ stage: opportunityStage })
export const changeOpportunityStatusSchema = z.object({
  status: opportunityStatus,
  statusReason: z.string().trim().max(500).optional(),
})
export const changeOpportunityNextStepSchema = z.object({
  nextStep: z.string().trim().max(500).nullable().optional(),
  nextStepDueOn: dateOnly.nullable().optional(),
  /** The unticked box under the Next step: also make it a task, for whoever ticks it (§24.11). */
  alsoCreateTask: z.boolean().optional(),
}).refine((body) => body.nextStep !== undefined || body.nextStepDueOn !== undefined, { message: "Nothing was changed" })

export const createOpportunityLineSchema = z.object({
  product: z.string().trim().min(1, "A line needs a product").max(180),
  oemBrand: z.string().trim().max(120).optional(),
  model: z.string().trim().max(120).optional(),
  quantity: z.number().int().positive().optional(),
  unitValue: money.optional(),
  lineValue: money.optional(),
  marginPercent: marginPercent.optional(),
  note: z.string().trim().max(500).optional(),
})
export const updateOpportunityLineSchema = createOpportunityLineSchema.partial()
  // Prices are nullable on edit though not on create, and the two states are
  // different answers: absent leaves the price alone, null takes it back off.
  // Without that difference a price typed by mistake can never be undone, and
  // storing 0 instead would claim the line is free.
  .extend({
    quantity: z.number().int().positive().nullable().optional(),
    unitValue: money.nullable().optional(),
    lineValue: money.nullable().optional(),
    marginPercent: marginPercent.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing was changed" })
export const reorderOpportunityLinesSchema = z.object({
  lineIds: z.array(z.string().uuid()).min(1).refine((ids) => new Set(ids).size === ids.length, { message: "Line ids must be unique" }),
})
export const opportunitySuggestionSchema = z.object({
  field: z.enum(["product", "brand", "model"]), q: z.string().trim().max(120).default(""),
})

export type ChangeOpportunityStageBody = z.infer<typeof changeOpportunityStageSchema>
export type ChangeOpportunityStatusBody = z.infer<typeof changeOpportunityStatusSchema>
export type ChangeOpportunityNextStepBody = z.infer<typeof changeOpportunityNextStepSchema>
export type CreateOpportunityLineBody = z.infer<typeof createOpportunityLineSchema>
export type UpdateOpportunityLineBody = z.infer<typeof updateOpportunityLineSchema>
export type ReorderOpportunityLinesBody = z.infer<typeof reorderOpportunityLinesSchema>
export type OpportunitySuggestionQuery = z.infer<typeof opportunitySuggestionSchema>

export const salesDashboardSchema = z.object({
  // A uuid, or the literal "all" for the team roll-up. Documented that way in
  // the plan, so PR D is written against it; a second spelling would be two
  // ways to say one thing.
  employeeId: z.union([z.literal("all"), z.string().uuid("Choose an employee")]).optional(),

})
export type SalesDashboardInput = z.infer<typeof salesDashboardSchema>

// ── meeting minutes (phase 4, revision §25) ──────────────────────────────────

const trueOnly = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => (value === "true" ? true : undefined))

/**
 * The whole document, as the editor sends it on Save (§25.8). The header is
 * not here: it is read from the meeting, so only what the meeting lacks is
 * typed (§25.4).
 */
export const saveMinutesSchema = z.object({
  purpose: z.string().trim().max(500).nullable().default(null),
  /** An extra line after the account under Meeting With, like "IT Department". */
  meetingWithNote: z.string().trim().max(200).nullable().default(null),
  sections: z.array(sectionInputSchema).max(20, "Minutes can have at most 20 sections"),
  preparers: z
    .array(
      z.object({
        employeeId: z.string().uuid(),
        titleExtra: z.string().trim().max(200).nullable().default(null),
      })
    )
    .max(10),
})

export const answerRequirementSchema = z.object({ found: z.boolean() })

export const listMinutesSchema = z.object({
  mine: trueOnly,
  status: z.enum(["DRAFT", "SENT", "EDITED_AFTER_SENDING"]).optional(),
})

export const waitingForMinutesSchema = z.object({ mine: trueOnly })

/** Who the copy went to, typed and optional: "Md. Salim Reza, by email" (§25.24). */
export const sendMinutesSchema = z.object({
  sentTo: z.string().trim().max(200).nullable().optional(),
})

// ── the weekly report (phase 5, revision §26) ────────────────────────────────

/** A day the person picked. The service turns it into a UTC-midnight date. */
const weeklyDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")

/** Which week to read. Absent means the week of today (§26.2). */
export const weekQuerySchema = z.object({ week: weeklyDate.optional() })

/**
 * The typed lines for one account on one day (§26.7, §26.8). Next step is
 * kept only where the account has no open deal; the service decides that.
 */
export const saveWeeklyNoteSchema = z.object({
  date: weeklyDate,
  salesAccountId: z.string().uuid(),
  challenges: z.string().trim().max(2000).nullable().default(null),
  gap: z.string().trim().max(2000).nullable().default(null),
  nextStep: z.string().trim().max(500).nullable().default(null),
  /** Turns the typed next step into a task for me, due a week out (§26.10). */
  makeTask: z.boolean().default(false),
})

/** A line of work with no account behind it (§26.11). */
export const addOtherWorkSchema = z.object({
  date: weeklyDate,
  text: z.string().trim().min(1, "Write what you did").max(1000),
})

/**
 * The weekly report's Application column, answered on the deal (§26.9).
 * Null clears it: "nobody has asked yet" is not "no software needed".
 */
export const setSoftwareNeededSchema = z.object({
  softwareNeeded: z.boolean().nullable(),
})
export type SetSoftwareNeededBody = z.infer<typeof setSoftwareNeededSchema>

export type WeekQueryInput = z.infer<typeof weekQuerySchema>
export type SaveWeeklyNoteBody = z.infer<typeof saveWeeklyNoteSchema>
export type AddOtherWorkInput = z.infer<typeof addOtherWorkSchema>

export type SaveMinutesBody = z.infer<typeof saveMinutesSchema>
export type ListMinutesQuery = z.infer<typeof listMinutesSchema>
