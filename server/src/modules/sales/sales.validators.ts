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
