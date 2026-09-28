import { z } from "zod"

export const MANUAL_RATE_MISSING = "Type the VAT %, or choose a VAT code."

const vatRate = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "Type the VAT % as a number with up to two decimals, like 7.5")
  .refine((v) => Number(v) <= 100, "VAT cannot be more than 100%")

/** Spread into a line schema's shape. */
export const vatChoiceFields = {
  vatMethod: z.enum(["CODE", "MANUAL"]).default("CODE"),
  vatRatePercent: vatRate.optional(),
}

/** Use with `.superRefine(requireManualRate)` on a line schema. */
export function requireManualRate(line: { vatMethod?: "CODE" | "MANUAL"; vatRatePercent?: string }, ctx: z.RefinementCtx) {
  if (line.vatMethod === "MANUAL" && line.vatRatePercent === undefined) {
    ctx.addIssue({ code: "custom", message: MANUAL_RATE_MISSING, path: ["vatRatePercent"] })
  }
}
