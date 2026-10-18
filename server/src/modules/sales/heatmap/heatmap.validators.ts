import { z } from "zod"

import { AppError } from "../../../middleware/errorHandler"
import type { HeatmapListLevel } from "../sales.types"

/**
 * The bodies for the Heatmap tab and its list in Sales Settings. Every
 * message is the sentence a person reads, so it is plain and says what to do.
 */

/** A product or part that is hidden, deleted, or never existed. */
export const NOT_ON_HEATMAP = "That is no longer on the heatmap. Reload the page and try again."

/** GREEN is a tick, RED is a cross, NONE clears it back to not checked. */
export const setMarkSchema = z.object({
  mark: z.enum(["GREEN", "RED", "NONE"], { error: "Choose a tick, a cross, or clear it." }),
})

export type SetMarkBody = z.infer<typeof setMarkSchema>

/** The note on a Red product is optional. An empty one removes it. */
export const setNoteSchema = z
  .object({
    note: z.string().trim().max(300, "Keep the note under 300 characters.").nullable().optional(),
  })
  .transform((b) => ({ note: b.note ? b.note : null }))

export type SetNoteBody = z.infer<typeof setNoteSchema>

const title = z.string({ error: "Write a name." }).trim().min(1, "Write a name.").max(80, "Keep the name under 80 characters.")
const note = z
  .string()
  .trim()
  .max(160, "Keep the short line under 160 characters.")
  .nullable()
  .optional()
  .transform((v) => (v ? v : null))

export const listRowSchema = z.object({ title, note })
export type ListRowBody = z.infer<typeof listRowSchema>

/** Only what is sent changes. An empty short line is sent as "" and clears it. */
export const listEditSchema = z
  .object({
    title: title.optional(),
    note: z.string().trim().max(160, "Keep the short line under 160 characters.").nullable().optional(),
    hidden: z.boolean().optional(),
  })
  .transform((b) => {
    const out: { title?: string; note?: string | null; hidden?: boolean } = {}
    if (b.title !== undefined) out.title = b.title
    if (b.note !== undefined) out.note = b.note ? b.note : null
    if (b.hidden !== undefined) out.hidden = b.hidden
    return out
  })
  .refine((b) => Object.keys(b).length > 0, "Nothing to change.")
export type ListEditBody = z.infer<typeof listEditSchema>

export const moveSchema = z.object({ direction: z.enum(["UP", "DOWN"], { error: "Move up or down." }) })

const LEVELS: readonly HeatmapListLevel[] = ["groups", "products", "parts"]

export function levelOf(raw: string): HeatmapListLevel {
  if (!(LEVELS as readonly string[]).includes(raw)) throw new AppError(404, NOT_ON_HEATMAP)
  return raw as HeatmapListLevel
}
