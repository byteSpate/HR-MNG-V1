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

export const createSalesContactSchema = z.object({
  name: z.string().trim().min(2, "A contact needs a name").max(160),
  designation: z.string().trim().max(120).optional(),
  // Both optional on purpose. "There is a procurement head called Rahman and
  // we do not have his number yet" is a real state, and it is exactly what
  // UNVERIFIED is for.
  phone: z.string().trim().max(32).optional(),
  email: z.string().trim().email("That is not an email address").toLowerCase().optional(),
  note: z.string().trim().max(500).optional(),
})

export type CreateSalesContactBody = z.infer<typeof createSalesContactSchema>

export const setContactStatusSchema = z.object({
  status: z.enum(["UNVERIFIED", "VERIFIED", "UNREACHABLE", "INVALID"]),
  /** Goes on the audit row, not over the contact's own note. */
  note: z.string().trim().max(500).optional(),
})

export type SetContactStatusBody = z.infer<typeof setContactStatusSchema>
