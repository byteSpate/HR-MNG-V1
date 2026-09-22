import { z } from "zod"

export const createCustomerSchema = z.object({
  legalName: z.string().trim().min(1, "A legal name is required").max(200),
  billingAddress: z.string().trim().max(500).optional(),
  bin: z.string().trim().max(20).optional(),
  paymentDays: z.number().int().min(0).max(365).optional(),
  salesAccountId: z.string().uuid().optional(),
})

// Create-only, and deliberately omitted from update: which Sales Account a
// Customer came from is a historical fact once set, the same way
// Opportunity.wonByEmployeeId is never rewritten later.
export const updateCustomerSchema = createCustomerSchema.omit({ salesAccountId: true })

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>
