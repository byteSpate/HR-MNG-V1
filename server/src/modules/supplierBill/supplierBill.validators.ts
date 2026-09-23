import { z } from "zod"

const billLineSchema = z.object({
  description: z.string().trim().min(1, "A description is required").max(300),
  kind: z.enum(["GOODS", "SERVICE"]),
  // The taka amount, always — see supplierBill.service.ts for how a USD
  // line converts sourceAmount into this at creation time.
  amount: z.string().refine((v) => Number(v) > 0, "Amount must be greater than zero"),
  sourceAmount: z.string().optional(),
  vatCodeId: z.string().uuid(),
  opportunityId: z.string().uuid(),
})

export const createSupplierBillSchema = z.object({
  supplierId: z.string().uuid(),
  billNumber: z.string().trim().min(1, "A bill number is required").max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD"),
  currency: z.enum(["BDT", "USD"]).default("BDT"),
  lines: z.array(billLineSchema).min(1, "At least one line is required"),
})

export const updateSupplierBillSchema = createSupplierBillSchema

export type CreateSupplierBillInput = z.infer<typeof createSupplierBillSchema>
export type UpdateSupplierBillInput = z.infer<typeof updateSupplierBillSchema>
