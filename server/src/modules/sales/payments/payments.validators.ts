import { z } from "zod"

const NOT_FOUND = "That account or Opportunity was not found. Reload the page and try again."

/** Which invoices a Payments table shows (owner, 2026-10-18). */
export const listPaymentsQuerySchema = z.object({
  accountId: z.string().uuid(NOT_FOUND).optional(),
  opportunityId: z.string().uuid(NOT_FOUND).optional(),
  /** "true" keeps the invoices that are not fully paid: the dashboard band. */
  open: z.enum(["true", "false"], { error: "Choose open or all." }).transform((v) => v === "true").optional(),
})

export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>
