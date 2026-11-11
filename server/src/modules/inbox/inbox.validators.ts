import { z } from "zod"

const flag = z
  .enum(["true", "false"], { error: "Use true or false." })
  .transform((v) => v === "true")
  .optional()

export const inboxQuery = z.object({
  tab: z.enum(["important", "primary", "all"], { error: "Choose a tab: important, primary or all." }),
  unread: flag,
  mine: flag,
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
})
export type InboxQueryInput = z.infer<typeof inboxQuery>
