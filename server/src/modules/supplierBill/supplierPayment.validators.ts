import { z } from "zod"

const allocationSchema = z.object({
  billId: z.string().uuid(),
  // In the payment's own currency.
  amount: z.string().refine((v) => Number(v) > 0, "Allocation amount must be greater than zero"),
})

export const createSupplierPaymentSchema = z.object({
  supplierId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  // In the payment's own currency; a USD payment is converted to taka at
  // the payment-date rate by supplierPayment.service.ts.
  amount: z.string().refine((v) => Number(v) > 0, "Amount must be greater than zero"),
  currency: z.enum(["BDT", "USD"]).default("BDT"),
  reference: z.string().trim().max(100).optional(),
  allocations: z.array(allocationSchema).default([]),
})

export type CreateSupplierPaymentInput = z.infer<typeof createSupplierPaymentSchema>
