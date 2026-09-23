import { z } from "zod"

const positiveMoney = z.string().refine((v) => Number(v) > 0, "Must be greater than zero")
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")

export const earningEventLineSchema = z.object({
  poLineId: z.string().uuid(),
  /// DELIVERY: required, the quantity delivered. ACCEPTANCE: absent.
  quantity: positiveMoney.optional(),
  /// ACCEPTANCE: required, the amount accepted. DELIVERY: absent (worked out).
  amount: positiveMoney.optional(),
})

export const createEarningEventSchema = z.object({
  poId: z.string().uuid(),
  kind: z.enum(["DELIVERY", "ACCEPTANCE"]),
  date: dateString,
  evidenceRef: z.string().trim().min(1, "Give the challan or acceptance note number"),
  note: z.string().trim().max(500).optional(),
  lines: z.array(earningEventLineSchema).min(1, "At least one line is required"),
})

export type CreateEarningEventInput = z.infer<typeof createEarningEventSchema>
