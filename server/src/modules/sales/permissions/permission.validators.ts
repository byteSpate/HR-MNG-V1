import { z } from "zod"

/**
 * The key is a plain string here. Whether it names a real, Phase 1 switch is
 * decided in `savePermissions`, against the catalog, so there is one list.
 */
export const savePermissionsSchema = z.object({
  changes: z
    .array(z.object({ key: z.string().min(1), enabled: z.boolean() }))
    .min(1, "Nothing was changed")
    .max(50),
})

export type SavePermissionsBody = z.infer<typeof savePermissionsSchema>
