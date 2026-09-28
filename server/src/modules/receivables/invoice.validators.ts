import { z } from "zod"

import { requireManualRate, vatChoiceFields } from "./receivables.vat.validators"

const positiveMoney = z.string().refine((v) => Number(v) > 0, "Must be greater than zero")
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")

export const invoiceLineSchema = z
  .object({
    poLineId: z.string().uuid(),
    description: z.string().trim().max(300).optional(),
    amount: positiveMoney,
    vatCodeId: z.string().uuid().optional(),
    // No default here: "not sent" means "copy the PO line" (spec §1.6).
    vatMethod: z.enum(["CODE", "MANUAL"]).optional(),
    vatRatePercent: vatChoiceFields.vatRatePercent,
  })
  .superRefine(requireManualRate)

export const createInvoiceSchema = z.object({
  poId: z.string().uuid(),
  invoiceNumber: z.string().trim().min(1, "An invoice number is required").max(100),
  date: dateString,
  dueDate: dateString.optional(),
  lines: z.array(invoiceLineSchema).min(1, "At least one line is required"),
})

export const updateInvoiceSchema = createInvoiceSchema.omit({ poId: true })

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>
