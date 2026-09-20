import { z } from "zod"

import { sectionInputSchema } from "./minutes.content"

export const salesDashboardSchema = z.object({
  // A uuid, or the literal "all" for the team roll-up. Documented that way in
  // the plan, so PR D is written against it; a second spelling would be two
  // ways to say one thing.
  employeeId: z.union([z.literal("all"), z.string().uuid("Choose an employee")]).optional(),

})
export type SalesDashboardInput = z.infer<typeof salesDashboardSchema>

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

// ── the weekly report (phase 5, revision §26) ────────────────────────────────

/** A day the person picked. The service turns it into a UTC-midnight date. */
const weeklyDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")

/** Which week to read. Absent means the week of today (§26.2). */
export const weekQuerySchema = z.object({ week: weeklyDate.optional() })

/**
 * The typed lines for one account on one day (§26.7, §26.8). Next step is
 * kept only where the account has no open deal; the service decides that.
 */
export const saveWeeklyNoteSchema = z.object({
  date: weeklyDate,
  salesAccountId: z.string().uuid(),
  challenges: z.string().trim().max(2000).nullable().default(null),
  gap: z.string().trim().max(2000).nullable().default(null),
  nextStep: z.string().trim().max(500).nullable().default(null),
  /** Turns the typed next step into a task for me, due a week out (§26.10). */
  makeTask: z.boolean().default(false),
})

/** A line of work with no account behind it (§26.11). */
export const addOtherWorkSchema = z.object({
  date: weeklyDate,
  text: z.string().trim().min(1, "Write what you did").max(1000),
})

export type WeekQueryInput = z.infer<typeof weekQuerySchema>
export type SaveWeeklyNoteBody = z.infer<typeof saveWeeklyNoteSchema>
export type AddOtherWorkInput = z.infer<typeof addOtherWorkSchema>

export type SaveMinutesBody = z.infer<typeof saveMinutesSchema>
export type ListMinutesQuery = z.infer<typeof listMinutesSchema>
