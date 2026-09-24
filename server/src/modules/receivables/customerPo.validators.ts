import { z } from "zod"

const positiveMoney = z.string().refine((v) => Number(v) > 0, "Must be greater than zero")
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")

export const poLineSchema = z.object({
  description: z.string().trim().min(1, "A description is required").max(300),
  kind: z.enum(["GOODS", "SERVICE"]),
  quantity: positiveMoney,
  unitPrice: positiveMoney,
  vatCodeId: z.string().uuid(),
})

export const createCustomerPoSchema = z.object({
  opportunityId: z.string().uuid(),
  customerPoNumber: z.string().trim().min(1, "A PO number is required").max(100),
  date: dateString,
  invoiceTo: z.string().trim().max(300).optional(),
  lines: z.array(poLineSchema).min(1, "At least one line is required"),
})

export const updateCustomerPoSchema = createCustomerPoSchema.omit({ opportunityId: true })

export const cancelCustomerPoSchema = z.object({
  reason: z.string().trim().min(1, "Give a reason for cancelling"),
})

export type CreateCustomerPoInput = z.infer<typeof createCustomerPoSchema>
export type UpdateCustomerPoInput = z.infer<typeof updateCustomerPoSchema>
export type CancelCustomerPoInput = z.infer<typeof cancelCustomerPoSchema>
