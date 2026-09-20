import { z } from "zod"

export const salesCommentEntitySchema = z.enum(["SALES_ACCOUNT", "OPPORTUNITY"])
export const createSalesCommentSchema = z.object({
  entity: salesCommentEntitySchema,
  entityId: z.string().uuid(),
  kind: z.enum(["GENERAL", "CUSTOMER_FEEDBACK", "MANAGEMENT_NOTE"]),
  body: z.string().trim().min(1, "A comment cannot be empty").max(4000),
})
export const listSalesCommentSchema = z.object({
  entity: salesCommentEntitySchema, entityId: z.string().uuid(),
})
export const updateSalesCommentSchema = z.object({
  body: z.string().trim().min(1, "A comment cannot be empty").max(4000),
})

export type CreateSalesCommentBody = z.infer<typeof createSalesCommentSchema>
export type ListSalesCommentQuery = z.infer<typeof listSalesCommentSchema>
export type UpdateSalesCommentBody = z.infer<typeof updateSalesCommentSchema>
