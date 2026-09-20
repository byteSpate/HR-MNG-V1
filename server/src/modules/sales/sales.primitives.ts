/**
 * The two Zod primitives that more than one Sales feature validates with.
 *
 * Moved here, unchanged, from `sales.validators.ts` when that file was split
 * per feature (Sales Hub phase 7). `money` is used by opportunities and
 * targets; `dateOnly` by opportunities and tasks. Every other constant that
 * file held is used by exactly one feature and travelled with it.
 *
 * `funnel/funnel.validators.ts` keeps its own copies on purpose.
 */

import { z } from "zod"

export const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount with up to two decimal places")
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
