import { z } from "zod"

import { dateOnly } from "../sales.primitives"

/** 2026-02-30 parses, as 2 March. A real date comes back unchanged. */
function isRealDate(iso: string): boolean {
  const parsed = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso
}

const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000

/**
 * The days a log picture covers: one day, or one week of the Logs tab
 * (Saturday to Friday, so seven days at most).
 */
export const dayLogQuerySchema = z
  .object({ from: dateOnly, to: dateOnly })
  .refine((q) => isRealDate(q.from) && isRealDate(q.to), {
    message: "One of the dates is not a real date. Check the day and the month.",
    path: ["from"],
  })
  .refine((q) => q.from <= q.to, {
    message: "The first day must be on or before the last day.",
    path: ["to"],
  })
  .refine((q) => dayNumber(q.to) - dayNumber(q.from) <= 6, {
    message: "A log can show one week at most. Choose seven days or fewer.",
    path: ["to"],
  })
export type DayLogQuery = z.infer<typeof dayLogQuerySchema>

/** Which picture of a long log, counting from 1. */
export const dayLogPictureSchema = z.object({
  picture: z.coerce.number().int().min(1, "Pictures count from 1.").max(100).default(1),
})
