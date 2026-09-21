import { z } from "zod"

import { money } from "../sales.primitives"

export const getTargetYearSchema = z.object({
  calendarYear: z.coerce.number().int().min(2000).max(2100),
  employeeId: z.union([z.literal("all"), z.string().uuid("Choose an employee")]).optional(),
})
export type GetTargetYearQueryInput = z.infer<typeof getTargetYearSchema>

export const setSalesTargetSchema = z.object({
  employeeId: z.string().uuid("Choose an employee"),
  calendarYear: z.coerce.number().int().min(2000).max(2100),
  // Taka of deal value for the year. More than zero: a target of zero is
  // indistinguishable on the page from no target at all, and "not set"
  // already says that better.
  amount: money.refine((value) => Number(value) > 0, "A yearly target is more than ৳0"),
  // The amount is split over this quarter and the ones after it, so somebody
  // who joins in July is not measured against January.
  startQuarter: z.coerce.number().int().min(1).max(4).default(1),
  note: z.string().trim().max(500).optional(),
})
export type SetSalesTargetInput = z.infer<typeof setSalesTargetSchema>
