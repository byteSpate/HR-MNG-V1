import { z } from "zod"

export const createSalesAccountSchema = z.object({
  name: z.string().trim().min(2, "A Sales Account needs a name").max(160),
  ownerEmployeeId: z.string().uuid("Choose an owner"),
  industry: z.string().trim().max(120).optional(),
  website: z.string().trim().max(200).optional(),
  address: z.string().trim().max(400).optional(),
  /** The extra people. The owner is ignored if it appears here. */
  assigneeIds: z.array(z.string().uuid()).max(20).optional(),
})

export type CreateSalesAccountBody = z.infer<typeof createSalesAccountSchema>
