import { z } from "zod"

import { dateOnly } from "../sales.primitives"

// ── tasks (phase 3, revision §24) ────────────────────────────────────────────
const taskPriority = z.enum(["LOW", "NORMAL", "HIGH"])

/**
 * What kind of work a task records (owner, 2026-11-02). The task is also the
 * daily log, so this is on every task, with or without an account. Keep the
 * order the same as the Prisma enum and the client list.
 */
export const taskType = z.enum([
  "VISIT_FOLLOW_UP", "QUOTATION_SENT", "REQUIREMENT_SENT", "CALL_OR_EMAIL", "LEARNING", "INTERNAL_WORK", "OTHER",
])

const NEEDS_ACCOUNT = "A task with an Opportunity or a meeting needs an account."
/** An Opportunity or a meeting always belongs to an account, so a task with one needs the account too. */
const needsAccountForLinks = (body: { salesAccountId?: string; opportunityId?: string; meetingId?: string }) =>
  Boolean(body.salesAccountId) || (!body.opportunityId && !body.meetingId)

/**
 * No owner and no origin: in this phase a task is always the caller's own
 * (§24.7), so there is nothing to choose. Unknown keys are dropped here, and
 * the service sets both fields itself.
 */
export const createTaskSchema = z
  .object({
    /** Optional (owner, 2026-11-02): learning and office work have no account. */
    salesAccountId: z.string().uuid().optional(),
    opportunityId: z.string().uuid().optional(),
    meetingId: z.string().uuid().optional(),
    title: z.string().trim().min(2, "Give the task a title").max(180),
    detail: z.string().trim().max(2000).optional(),
    dueOn: dateOnly,
    priority: taskPriority.default("NORMAL"),
    type: taskType.default("OTHER"),
  })
  .refine(needsAccountForLinks, { message: NEEDS_ACCOUNT, path: ["salesAccountId"] })

/**
 * "I did this": something already done, written in one line. The day is a
 * date, not a time. The service refuses a day in the future.
 */
export const logDoneSchema = z
  .object({
    title: z.string().trim().min(2, "Give the task a title").max(180),
    type: taskType,
    doneOn: dateOnly,
    salesAccountId: z.string().uuid().optional(),
    opportunityId: z.string().uuid().optional(),
    detail: z.string().trim().max(2000).optional(),
  })
  .refine(needsAccountForLinks, { message: NEEDS_ACCOUNT, path: ["salesAccountId"] })

export const updateTaskSchema = z
  .object({
    opportunityId: z.string().uuid().nullable().optional(),
    meetingId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(2, "Give the task a title").max(180).optional(),
    detail: z.string().trim().max(2000).nullable().optional(),
    dueOn: dateOnly.optional(),
    priority: taskPriority.optional(),
    type: taskType.optional(),
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
  origin: z.enum(["SELF", "FUNNEL_MEETING", "PROJECT", "TAKE_OUT"]).optional(),
  type: taskType.optional(),
  /** Logs: tasks that belong to no account. */
  noAccount: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === "true" ? true : undefined)),
  /** Take-outs: tasks an admin gave, at a meeting or outside one. */
  takeOuts: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === "true" ? true : undefined)),
  /** The day a task counts for: the day it was done, or its due day when it is not done. */
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  /** Only a Sales Admin may read another person's tasks; the service ignores it for anyone else. */
  assignedToEmployeeId: z.string().uuid().optional(),
  salesAccountId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  meetingId: z.string().uuid().optional(),
  mine: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === "true" ? true : undefined)),
})

export type CreateTaskBody = z.infer<typeof createTaskSchema>
export type LogDoneBody = z.infer<typeof logDoneSchema>
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>
export type ChangeTaskStatusBody = z.infer<typeof changeTaskStatusSchema>
export type ListTaskQuery = z.infer<typeof listTaskSchema>
