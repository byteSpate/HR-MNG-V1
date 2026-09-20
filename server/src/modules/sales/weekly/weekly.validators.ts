import { z } from "zod"

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
