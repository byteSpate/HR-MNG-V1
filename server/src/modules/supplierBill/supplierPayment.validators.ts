import { z } from "zod"

const allocationSchema = z.object({
  billId: z.string().uuid(),
  // Taka figure. An allocation that leaves nothing unallocated is an
  // ordinary payment; one that allocates less than the payment amount
  // leaves the rest as an advance (design §3.1).
  amount: z.string().refine((v) => Number(v) > 0, "Allocation amount must be greater than zero"),
})

export const createSupplierPaymentSchema = z.object({
  supplierId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  // Taka, always — see supplierPayment.service.ts for how a USD payment's
  // sourceAmount converts into this.
  amount: z.string().refine((v) => Number(v) > 0, "Amount must be greater than zero"),
  sourceAmount: z.string().optional(),
  currency: z.enum(["BDT", "USD"]).default("BDT"),
  reference: z.string().trim().max(100).optional(),
  // Empty array is a pure advance — design §3.1 "Advance paid (no bill yet)".
  allocations: z.array(allocationSchema).default([]),
})

export type CreateSupplierPaymentInput = z.infer<typeof createSupplierPaymentSchema>

export const matchAdvanceSchema = z.object({
  billId: z.string().uuid(),
  amount: z.string().refine((v) => Number(v) > 0, "Amount must be greater than zero"),
})

export type MatchAdvanceInput = z.infer<typeof matchAdvanceSchema>
