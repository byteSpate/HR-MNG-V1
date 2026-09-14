import { z } from "zod"

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

const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount with up to two decimal places")
// The profit on a deal, as a percentage of its value. Negative is a deal sold
// at a loss; beyond 100 either way is a typing mistake, not a margin.
const marginPercent = z
  .string()
  .regex(/^-?\d{1,3}(\.\d{1,2})?$/, "Enter the margin as a percentage with up to two decimal places, like 12.5")
  .refine((value) => Math.abs(Number(value)) <= 100, "A margin is between -100% and 100%")
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
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

// ── tasks (phase 3, revision §24) ────────────────────────────────────────────
const taskPriority = z.enum(["LOW", "NORMAL", "HIGH"])

/**
 * No owner and no origin: in this phase a task is always the caller's own
 * (§24.7), so there is nothing to choose. Unknown keys are dropped here, and
 * the service sets both fields itself.
 */
export const createTaskSchema = z.object({
  salesAccountId: z.string().uuid(),
  opportunityId: z.string().uuid().optional(),
  meetingId: z.string().uuid().optional(),
  title: z.string().trim().min(2, "Give the task a title").max(180),
  detail: z.string().trim().max(2000).optional(),
  dueOn: dateOnly,
  priority: taskPriority.default("NORMAL"),
})

export const updateTaskSchema = z
  .object({
    opportunityId: z.string().uuid().nullable().optional(),
    meetingId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(2, "Give the task a title").max(180).optional(),
    detail: z.string().trim().max(2000).nullable().optional(),
    dueOn: dateOnly.optional(),
    priority: taskPriority.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing was changed" })

export const changeTaskStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("DONE"), outcome: z.string().trim().max(2000).optional() }),
  z.object({
    status: z.literal("CANCELLED"),
    reason: z.string().trim().min(2, "Say why the task is cancelled").max(500),
  }),
  z.object({ status: z.literal("PENDING") }),
])

export const listTaskSchema = z.object({
  status: z.enum(["PENDING", "DONE", "CANCELLED"]).optional(),
  // "now" is due today or overdue: the overview's "Tasks due or overdue" row.
  due: z.enum(["overdue", "today", "now", "week"]).optional(),
  origin: z.enum(["SELF", "FUNNEL_MEETING"]).optional(),
  salesAccountId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().optional(),
  meetingId: z.string().uuid().optional(),
  mine: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === "true" ? true : undefined)),
})

export type CreateTaskBody = z.infer<typeof createTaskSchema>
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>
export type ChangeTaskStatusBody = z.infer<typeof changeTaskStatusSchema>
export type ListTaskQuery = z.infer<typeof listTaskSchema>

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

export const salesCommentEntitySchema = z.enum(["SALES_ACCOUNT", "OPPORTUNITY"])
export const createSalesCommentSchema = z.object({
  entity: salesCommentEntitySchema,
  entityId: z.string().uuid(),
  kind: z.enum(["GENERAL", "CUSTOMER_FEEDBACK", "MANAGEMENT_NOTE"]),
  body: z.string().trim().min(1, "A comment cannot be empty").max(4000),
})
export const listSalesCommentSchema = z.object({
  entity: salesCommentEntitySchema, entityId: z.string().uuid(),
})
export const updateSalesCommentSchema = z.object({
  body: z.string().trim().min(1, "A comment cannot be empty").max(4000),
})

export type ChangeOpportunityStageBody = z.infer<typeof changeOpportunityStageSchema>
export type ChangeOpportunityStatusBody = z.infer<typeof changeOpportunityStatusSchema>
export type ChangeOpportunityNextStepBody = z.infer<typeof changeOpportunityNextStepSchema>
export type CreateOpportunityLineBody = z.infer<typeof createOpportunityLineSchema>
export type UpdateOpportunityLineBody = z.infer<typeof updateOpportunityLineSchema>
export type ReorderOpportunityLinesBody = z.infer<typeof reorderOpportunityLinesSchema>
export type OpportunitySuggestionQuery = z.infer<typeof opportunitySuggestionSchema>
export type CreateSalesCommentBody = z.infer<typeof createSalesCommentSchema>
export type ListSalesCommentQuery = z.infer<typeof listSalesCommentSchema>
export type UpdateSalesCommentBody = z.infer<typeof updateSalesCommentSchema>

export const getTargetYearSchema = z.object({
  calendarYear: z.coerce.number().int().min(2000).max(2100),
  employeeId: z.union([z.literal("all"), z.string().uuid("Choose an employee")]).optional(),
})
export type GetTargetYearQueryInput = z.infer<typeof getTargetYearSchema>

export const setSalesTargetSchema = z.object({
  employeeId: z.string().uuid("Choose an employee"),
  calendarYear: z.coerce.number().int().min(2000).max(2100),
  // Taka of deal value for the year. More than zero: a target of zero is
  // indistinguishable on the page from no target at all, and "not set"
  // already says that better.
  amount: money.refine((value) => Number(value) > 0, "A yearly target is more than ৳0"),
  // The amount is split over this quarter and the ones after it, so somebody
  // who joins in July is not measured against January.
  startQuarter: z.coerce.number().int().min(1).max(4).default(1),
  note: z.string().trim().max(500).optional(),
})
export type SetSalesTargetInput = z.infer<typeof setSalesTargetSchema>

export const salesDashboardSchema = z.object({
  // A uuid, or the literal "all" for the team roll-up. Documented that way in
  // the plan, so PR D is written against it; a second spelling would be two
  // ways to say one thing.
  employeeId: z.union([z.literal("all"), z.string().uuid("Choose an employee")]).optional(),

})
export type SalesDashboardInput = z.infer<typeof salesDashboardSchema>
