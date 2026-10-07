import { z } from "zod"

import { parseDateOnly } from "../../../utils/dates"

/**
 * The bodies for the Heatmap tab. Every message is the sentence a person
 * reads on the form, so it is plain and says what to do.
 */

/** Said for an item id that is not on the account, or is not an id at all. */
export const NO_SUCH_ITEM = "That item is not on this account. Reload the page and try again."

const isRealDate = (value: string) => {
  try {
    parseDateOnly(value)
    return true
  } catch {
    return false
  }
}

/** Optional text: blank means "not recorded", stored as null. */
const optText = (max: number, what: string) =>
  z
    .string()
    .trim()
    .max(max, `Keep the ${what} under ${max} characters.`)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null))

const optDate = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isRealDate(v), "Pick a real date.")

export const setNeedSchema = z
  .object({
    need: z.enum(["NEED", "NO_NEED", "NOT_ASKED"], { error: "Pick Need it, No need, or Not asked yet." }),
    reason: z.string().trim().max(300, "Keep the reason under 300 characters.").nullable().optional(),
  })
  .transform((b) => ({ need: b.need, reason: b.need === "NO_NEED" ? b.reason || null : null }))
  .refine((b) => b.need !== "NO_NEED" || b.reason !== null, "Write why they do not need it.")

export type SetNeedBody = z.infer<typeof setNeedSchema>

/**
 * One item on a card. Only the brand and how many are needed. The extra
 * fields come as short text; what each may hold depends on the card, so that
 * is checked in `checkDetails`, not here.
 */
export const heatmapItemSchema = z.object({
  brand: z.string({ error: "Write the brand." }).trim().min(1, "Write the brand.").max(100, "Keep the brand under 100 characters."),
  model: optText(100, "model"),
  quantity: z
    .number({ error: "Write how many they have." })
    .int("How many must be a whole number.")
    .min(1, "How many must be at least 1.")
    .max(1_000_000, "How many must be under 1,000,000."),
  site: optText(100, "site"),
  boughtFrom: optText(100, "seller name"),
  boughtOn: optDate,
  supportEndsOn: optDate,
  endOfLifeOn: optDate,
  supportBy: optText(100, "support company name"),
  notes: optText(500, "notes"),
  details: z
    .record(z.string().max(40), z.string().max(200, "Keep each field under 200 characters."))
    .refine((d) => Object.keys(d).length <= 20, "An item has up to 20 extra fields.")
    .optional()
    .transform((d) => d ?? {}),
})

export type HeatmapItemBody = z.infer<typeof heatmapItemSchema>
