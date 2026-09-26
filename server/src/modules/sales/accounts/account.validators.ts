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

/**
 * Editing a contact's own details. Every field optional, same reasoning as
 * `updateSalesAccountSchema`: the form sends only what changed, but a body
 * with nothing in it is a mistake worth naming.
 *
 * The "must be reachable somehow" rule from `createSalesContactSchema` is not
 * repeated here as a `.refine` — an edit only sends the fields that changed,
 * so this schema alone cannot know whether the *other*, unsent field is still
 * set. That check belongs in the service, which has the existing row to
 * check the merged result against.
 */
export const updateSalesContactSchema = z
  .object({
    name: z.string().trim().min(2, "A contact needs a name").max(160).optional(),
    designation: z.string().trim().max(120).nullable().optional(),
    phone: z.string().trim().max(32).nullable().optional(),
    email: z.string().trim().email("That is not an email address").toLowerCase().nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Nothing was changed",
  })

export type UpdateSalesContactBody = z.infer<typeof updateSalesContactSchema>

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
