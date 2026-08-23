import { z } from "zod"

/**
 * `failedOnly` arrives as a query string, so it is the literal "true" rather
 * than a boolean. Anything else — absent, "false", "0" — reads as off.
 */
export const dispatchQuerySchema = z.object({
  kind: z.string().min(1).optional(),
  failedOnly: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

export type DispatchQueryInput = z.infer<typeof dispatchQuerySchema>
