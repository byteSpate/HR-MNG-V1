import { z } from "zod"

export const draftEarningRunSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
})
export type DraftEarningRunInput = z.infer<typeof draftEarningRunSchema>

export const reverseEarningRunSchema = z.object({
  reason: z.string().trim().min(1, "Give a reason for the reversal").max(1000),
})
export type ReverseEarningRunInput = z.infer<typeof reverseEarningRunSchema>
