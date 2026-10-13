import { z } from "zod"

/**
 * The bodies for the Heatmap tab and its list in Sales Settings. Every
 * message is the sentence a person reads, so it is plain and says what to do.
 */

/** A product or part that is hidden, deleted, or never existed. */
export const NOT_ON_HEATMAP = "That is no longer on the heatmap. Reload the page and try again."

export const setColourSchema = z
  .object({
    colour: z.enum(["GREEN", "RED", "NONE"], { error: "Pick Green or Red." }),
    reason: z.string().trim().max(300, "Keep the reason under 300 characters.").nullable().optional(),
  })
  .transform((b) => ({ colour: b.colour, reason: b.colour === "RED" ? b.reason || null : null }))
  .refine((b) => b.colour !== "RED" || b.reason !== null, "Write why there is no chance here.")

export type SetColourBody = z.infer<typeof setColourSchema>

export const setScopeSchema = z.object({
  inScope: z.boolean({ error: "Tick or untick the part." }),
})

export type SetScopeBody = z.infer<typeof setScopeSchema>
