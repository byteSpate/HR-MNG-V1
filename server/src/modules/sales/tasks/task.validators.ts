import { z } from "zod"

import { dateOnly } from "../sales.primitives"

// ── tasks (phase 3, revision §24) ────────────────────────────────────────────
const taskPriority = z.enum(["LOW", "NORMAL", "HIGH"])

/**
 * No owner and no origin: in this phase a task is always the caller's own
 * (§24.7), so there is nothing to choose. Unknown keys are dropped here, and
 * the service sets both fields itself.
 */
export const createTaskSchema = z.object({
  salesAccountId: z.string().uuid(),
  opportunityId: z.string().uuid().optional(),
  meetingId: z.string().uuid().optional(),
  title: z.string().trim().min(2, "Give the task a title").max(180),
  detail: z.string().trim().max(2000).optional(),
  dueOn: dateOnly,
  priority: taskPriority.default("NORMAL"),
})

export const updateTaskSchema = z
  .object({
    opportunityId: z.string().uuid().nullable().optional(),
    meetingId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(2, "Give the task a title").max(180).optional(),
    detail: z.string().trim().max(2000).nullable().optional(),
    dueOn: dateOnly.optional(),
    priority: taskPriority.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing was changed" })

export const changeTaskStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("DONE"), outcome: z.string().trim().max(2000).optional() }),
  z.object({
    status: z.literal("CANCELLED"),
    reason: z.string().trim().min(2, "Say why the task is cancelled").max(500),
  }),
  z.object({ status: z.literal("PENDING") }),
])

export const listTaskSchema = z.object({
  status: z.enum(["PENDING", "DONE", "CANCELLED"]).optional(),
  // "now" is due today or overdue: the overview's "Tasks due or overdue" row.
  due: z.enum(["overdue", "today", "now", "week"]).optional(),
  origin: z.enum(["SELF", "FUNNEL_MEETING"]).optional(),
  salesAccountId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().optional(),
  meetingId: z.string().uuid().optional(),
  mine: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === "true" ? true : undefined)),
})

export type CreateTaskBody = z.infer<typeof createTaskSchema>
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>
export type ChangeTaskStatusBody = z.infer<typeof changeTaskStatusSchema>
export type ListTaskQuery = z.infer<typeof listTaskSchema>
