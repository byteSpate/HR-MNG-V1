import { z } from "zod"

const creditLineSchema = z.object({
  billLineId: z.string().uuid(),
  amount: z.string().refine((v) => Number(v) > 0, "Amount must be greater than zero"),
  vatAmount: z.string().default("0"),
})

export const createSupplierCreditNoteSchema = z.object({
  billId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  reason: z.string().trim().min(1, "A reason is required").max(500),
  lines: z.array(creditLineSchema).min(1, "At least one line is required"),
})

export type CreateSupplierCreditNoteInput = z.infer<typeof createSupplierCreditNoteSchema>
