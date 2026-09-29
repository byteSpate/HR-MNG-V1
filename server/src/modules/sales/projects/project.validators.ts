import { z } from "zod"

import { dateOnly, money } from "../sales.primitives"

export const projectStatus = z.enum(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "ON_HOLD", "COMPLETED", "CANCELLED"])

export const listProjectSchema = z.object({
  status: projectStatus.optional(),
  managerEmployeeId: z.string().uuid().optional(),
  salesAccountId: z.string().uuid().optional(),
  track: z.enum(["NETWORKING", "SOFTWARE_DEVELOPMENT"]).optional(),
})

export const updateProjectSchema = z.object({
  name: z.string().trim().min(2, "A Project needs a name").max(180).optional(),
  managerEmployeeId: z.string().uuid().optional(),
  startOn: dateOnly.nullable().optional(),
  dueOn: dateOnly.nullable().optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH"]).optional(),
  budget: money.nullable().optional(),
}).refine((b) => Object.keys(b).length > 0, { message: "Nothing was changed" })

export const setProjectTeamSchema = z.object({
  members: z.array(z.object({
    employeeId: z.string().uuid(),
    responsibility: z.string().trim().max(300).nullable().optional(),
  })).max(50).refine((m) => new Set(m.map((x) => x.employeeId)).size === m.length, { message: "A person is on the team twice" }),
})

export const changeProjectStatusSchema = z.object({
  status: projectStatus,
  reason: z.string().trim().max(500).optional(),
})

export const addMilestoneSchema = z.object({
  title: z.string().trim().min(1, "Give the milestone a name").max(180),
  dueOn: dateOnly.nullable().optional(),
})

export const updateMilestoneSchema = z.object({
  title: z.string().trim().min(1).max(180).optional(),
  dueOn: dateOnly.nullable().optional(),
  done: z.boolean().optional(),
}).refine((b) => Object.keys(b).length > 0, { message: "Nothing was changed" })

/**
 * A Project Task carries only what to do, a date and who does it (spec §2.1).
 * No assignee means the caller: the page cannot know who is asking, the
 * server does, so a person taking their own work sends nothing.
 */
export const addProjectTaskSchema = z.object({
  title: z.string().trim().min(2, "Say what needs to be done").max(180),
  dueOn: dateOnly,
  assigneeEmployeeId: z.string().uuid().optional(),
})
export type AddProjectTaskBody = z.infer<typeof addProjectTaskSchema>

export const cancelProjectTaskSchema = z.object({
  reason: z.string().trim().min(2, "Say why the task is cancelled").max(500),
})
export type CancelProjectTaskBody = z.infer<typeof cancelProjectTaskSchema>

export type ListProjectQuery = z.infer<typeof listProjectSchema>
export type UpdateProjectBody = z.infer<typeof updateProjectSchema>
export type SetProjectTeamBody = z.infer<typeof setProjectTeamSchema>
export type ChangeProjectStatusBody = z.infer<typeof changeProjectStatusSchema>
export type AddMilestoneBody = z.infer<typeof addMilestoneSchema>
export type UpdateMilestoneBody = z.infer<typeof updateMilestoneSchema>
