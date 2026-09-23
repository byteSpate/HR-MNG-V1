import { z } from "zod"

const positiveMoney = z.string().refine((v) => Number(v) > 0, "Must be greater than zero")
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")

export const createCustomerCreditNoteSchema = z.object({
  invoiceId: z.string().uuid(),
  date: dateString,
  reason: z.string().trim().min(1, "Give a reason for the credit note"),
  lines: z.array(z.object({ invoiceLineId: z.string().uuid(), amount: positiveMoney })).min(1, "At least one line is required"),
})

export type CreateCustomerCreditNoteInput = z.infer<typeof createCustomerCreditNoteSchema>
