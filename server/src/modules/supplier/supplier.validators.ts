import { z } from "zod"

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1, "A name is required").max(200),
  contactName: z.string().trim().max(100).optional(),
  contactPhone: z.string().trim().max(30).optional(),
  contactEmail: z.string().trim().email().optional(),
  bin: z.string().trim().max(20).optional(),
  paymentDays: z.number().int().min(0).max(365).optional(),
})

export const updateSupplierSchema = createSupplierSchema

export const quickAddSupplierSchema = z.object({
  name: z.string().trim().min(1, "Write a supplier name").max(200),
})

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>
export type QuickAddSupplierInput = z.infer<typeof quickAddSupplierSchema>
