import { z } from "zod"

export const APPROVAL_KINDS = ["INVOICE", "SUPPLIER_BILL", "CUSTOMER_CREDIT_NOTE", "SUPPLIER_CREDIT_NOTE"] as const

// dealMoney.sendBack.ts refuses both credit-note kinds (they have no update/delete
// path, so a sent-back credit note could never be fixed or re-approved). The route
// rejects them here, before the service or a transaction ever runs, rather than
// relying only on the service's 409 — a control that can never succeed for a kind
// is worth refusing at the door, not just deep inside.
export const SEND_BACK_KINDS = ["INVOICE", "SUPPLIER_BILL"] as const

export const dealMoneyListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().positive().optional(),
})

export const sendBackBodySchema = z.object({
  note: z.string(),
})

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")

export const vatSummaryQuerySchema = z.object({
  from: dateOnly,
  to: dateOnly,
}).refine((q) => q.to >= q.from, { message: "The end date is before the start date.", path: ["to"] })

export type DealMoneyListQuery = z.infer<typeof dealMoneyListQuerySchema>
export type SendBackBody = z.infer<typeof sendBackBodySchema>
export type VatSummaryQuery = z.infer<typeof vatSummaryQuerySchema>
