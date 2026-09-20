import { z } from "zod"

import { sectionInputSchema } from "./minutes.content"

// ── meeting minutes (phase 4, revision §25) ──────────────────────────────────

const trueOnly = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => (value === "true" ? true : undefined))

/**
 * The whole document, as the editor sends it on Save (§25.8). The header is
 * not here: it is read from the meeting, so only what the meeting lacks is
 * typed (§25.4).
 */
export const saveMinutesSchema = z.object({
  purpose: z.string().trim().max(500).nullable().default(null),
  /** An extra line after the account under Meeting With, like "IT Department". */
  meetingWithNote: z.string().trim().max(200).nullable().default(null),
  sections: z.array(sectionInputSchema).max(20, "Minutes can have at most 20 sections"),
  preparers: z
    .array(
      z.object({
        employeeId: z.string().uuid(),
        titleExtra: z.string().trim().max(200).nullable().default(null),
      })
    )
    .max(10),
})

export const answerRequirementSchema = z.object({ found: z.boolean() })

export const listMinutesSchema = z.object({
  mine: trueOnly,
  status: z.enum(["DRAFT", "SENT", "EDITED_AFTER_SENDING"]).optional(),
})

export const waitingForMinutesSchema = z.object({ mine: trueOnly })

/** Who the copy went to, typed and optional: "Md. Salim Reza, by email" (§25.24). */
export const sendMinutesSchema = z.object({
  sentTo: z.string().trim().max(200).nullable().optional(),
})

export type SaveMinutesBody = z.infer<typeof saveMinutesSchema>
export type ListMinutesQuery = z.infer<typeof listMinutesSchema>
