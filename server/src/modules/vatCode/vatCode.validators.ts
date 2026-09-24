import { z } from "zod"

const rate = z.string()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "Write the rate as a number, like 15 or 7.5")
  .refine((v) => Number(v) <= 100, "A rate cannot be more than 100")

export const createVatCodeSchema = z.object({
  code: z.string().trim().min(1, "Write a code").max(20).regex(/^[A-Z0-9_]+$/, "Use capital letters, numbers and _ only"),
  name: z.string().trim().min(1, "Write a name").max(80),
  ratePercent: rate,
})

export const updateVatCodeSchema = z.object({
  name: z.string().trim().min(1, "Write a name").max(80).optional(),
  ratePercent: rate.optional(),
  isActive: z.boolean().optional(),
})

export type CreateVatCodeInput = z.infer<typeof createVatCodeSchema>
export type UpdateVatCodeInput = z.infer<typeof updateVatCodeSchema>
