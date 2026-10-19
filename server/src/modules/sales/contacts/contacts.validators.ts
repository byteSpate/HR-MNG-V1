import { z } from "zod"

/** The Contacts page query (owner, 2026-10-18). Every message is the sentence a person reads. */
export const listContactsQuerySchema = z.object({
  q: z.string().trim().max(100, "Keep the search under 100 characters.").optional().transform((v) => (v ? v : undefined)),
  page: z.coerce.number({ error: "Choose a page." }).int("Choose a page.").min(1, "Choose a page.").default(1),
  sort: z.enum(["name", "designation", "account", "status"], { error: "Sort by name, job title, account or status." }).default("name"),
  dir: z.enum(["asc", "desc"], { error: "Sort up or down." }).default("asc"),
})

export type ListContactsQuery = z.infer<typeof listContactsQuerySchema>
