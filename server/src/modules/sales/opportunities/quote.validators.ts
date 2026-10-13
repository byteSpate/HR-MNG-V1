import { z } from "zod"

import { dateOnly, money } from "../sales.primitives"

/**
 * The bodies for quotes (owner, 2026-10-13). Every message is the sentence a
 * person reads on the form.
 */

const optText = (max: number, what: string) =>
  z
    .string()
    .trim()
    .max(max, `Keep the ${what} under ${max} characters.`)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null))

export const quoteSchema = z.object({
  amount: money,
  quotedOn: dateOnly,
  reference: optText(60, "quote number"),
  note: optText(300, "note"),
})

export type QuoteBody = z.infer<typeof quoteSchema>

/** Why an Opportunity moved into a quote stage with no quote. */
export const skipReasonSchema = z
  .string()
  .trim()
  .min(1, "Write why there is no quote yet.")
  .max(300, "Keep the reason under 300 characters.")
