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

const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount with up to two decimal places")
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
}).refine((body) => body.nextStep !== undefined || body.nextStepDueOn !== undefined, { message: "Nothing was changed" })

export const createOpportunityLineSchema = z.object({
  product: z.string().trim().min(1, "A line needs a product").max(180),
  oemBrand: z.string().trim().max(120).optional(),
  model: z.string().trim().max(120).optional(),
  quantity: z.number().int().positive().optional(),
  unitValue: money.optional(),
  lineValue: money.optional(),
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
  employeeId: z.string().uuid().optional(),
})
export type GetTargetYearQueryInput = z.infer<typeof getTargetYearSchema>

export const setSalesTargetSchema = z.object({
  employeeId: z.string().uuid("Choose an employee"),
  calendarYear: z.coerce.number().int().min(2000).max(2100),
  quarter: z.coerce.number().int().min(1).max(4),
  // At least one. A target of zero is indistinguishable on the page from no
  // target at all, and "not set" already says that better.
  targetDeals: z.coerce.number().int().min(1, "A target is at least one deal").max(1000),
  note: z.string().trim().max(500).optional(),
})
export type SetSalesTargetInput = z.infer<typeof setSalesTargetSchema>

export const salesDashboardSchema = z.object({
  employeeId: z.string().uuid().optional(),
  scope: z.enum(["me", "all"]).optional(),
})
export type SalesDashboardInput = z.infer<typeof salesDashboardSchema>
