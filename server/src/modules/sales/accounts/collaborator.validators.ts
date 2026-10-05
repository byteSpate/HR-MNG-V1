import { z } from "zod"

export const addCollaboratorSchema = z.object({
  employeeId: z.string().uuid("Choose a person"),
})
export type AddCollaboratorBody = z.infer<typeof addCollaboratorSchema>

export const removalRequestSchema = z.object({
  employeeId: z.string().uuid("Choose a collaborator"),
})

export const listRemovalsQuerySchema = z.object({
  accountId: z.string().uuid().optional(),
  status: z.enum(["PENDING", "APPROVED", "REFUSED", "CANCELLED"]).optional(),
})

export const refuseRemovalSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Say why you are refusing. A short reason is enough.")
    .max(300, "Keep the reason under 300 letters."),
})
