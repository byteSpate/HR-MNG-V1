/**
 * The two Zod primitives that more than one Sales feature validates with.
 *
 * Moved here, unchanged, from the shared validators file that Sales Hub
 * phase 7 split up per feature. `money` is used by opportunities and targets;
 * `dateOnly` by opportunities and tasks. Every other constant that file held
 * is used by exactly one feature and travelled with it.
 *
 * `funnel/funnel.validators.ts` keeps its own copies on purpose.
 */

import { z } from "zod"

export const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount with up to two decimal places")
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")

/**
 * The search box on a Sales list (owner, 2026-11-10). Searched on the server,
 * because every list but Accounts is capped, and a search over the rows the
 * page happens to hold would miss the rest. Blank means no search.
 */
export const searchText = z
  .string()
  .trim()
  .max(100, "Keep the search under 100 characters.")
  .transform((v) => (v ? v : undefined))
  .optional()

/** Case does not matter: "dhaka" finds "Dhaka Bank". */
export const containsText = (q: string) => ({ contains: q, mode: "insensitive" as const })
