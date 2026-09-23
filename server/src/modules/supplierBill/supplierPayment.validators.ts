import { z } from "zod"

const allocationSchema = z.object({
  billId: z.string().uuid(),
  // In the payment's own currency. Allocating less than the payment amount
  // leaves the rest as an advance (design §3.1).
  amount: z.string().refine((v) => Number(v) > 0, "Allocation amount must be greater than zero"),
})

// Settles what the supplier was owed on go-live (Phase 2 gap, fixed here) —
// a supplier has at most one opening balance, so this is a single object,
// not an array of allocations.
const openingAllocationSchema = z.object({
  amount: z.string().refine((v) => Number(v) > 0, "Opening balance allocation amount must be greater than zero"),
})

export const createSupplierPaymentSchema = z.object({
  supplierId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  // In the payment's own currency; a USD payment is converted to taka at
  // the payment-date rate by supplierPayment.service.ts.
  amount: z.string().refine((v) => Number(v) > 0, "Amount must be greater than zero"),
  currency: z.enum(["BDT", "USD"]).default("BDT"),
  reference: z.string().trim().max(100).optional(),
  // Empty array is a pure advance — design §3.1 "Advance paid (no bill yet)".
  allocations: z.array(allocationSchema).default([]),
  openingAllocation: openingAllocationSchema.optional(),
})

export type CreateSupplierPaymentInput = z.infer<typeof createSupplierPaymentSchema>

export const matchAdvanceSchema = z
  .object({
    billId: z.string().uuid().optional(),
    openingBalanceId: z.string().uuid().optional(),
    amount: z.string().refine((v) => Number(v) > 0, "Amount must be greater than zero"),
  })
  .refine((v) => Boolean(v.billId) !== Boolean(v.openingBalanceId), {
    message: "Choose a bill or the opening balance, not both",
  })

export type MatchAdvanceInput = z.infer<typeof matchAdvanceSchema>
