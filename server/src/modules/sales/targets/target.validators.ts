import { z } from "zod"

import { dateOnly, money } from "../sales.primitives"

export const getTargetYearSchema = z.object({
  calendarYear: z.coerce.number().int().min(2000).max(2100),
  employeeId: z.union([z.literal("all"), z.string().uuid("Choose an employee")]).optional(),
})
export type GetTargetYearQueryInput = z.infer<typeof getTargetYearSchema>

/** 2026-02-30 parses, as 2 March. A real date comes back unchanged. */
function isRealDate(iso: string): boolean {
  const parsed = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso
}

export const setSalesTargetSchema = z.object({
  employeeId: z.string().uuid("Choose an employee"),
  calendarYear: z.coerce.number().int().min(2000).max(2100),
  // Taka of deal value for the year. More than zero: a target of zero is
  // indistinguishable on the page from no target at all, and "not set"
  // already says that better.
  amount: money.refine((value) => Number(value) > 0, "A yearly target is more than ৳0"),
  // The dates the target covers, inside the calendar year (owner,
  // 2026-11-10). The amount is split over the quarters the range covers, so
  // somebody who joins on 15 July is not measured against January.
  startDate: dateOnly,
  endDate: dateOnly,
  note: z.string().trim().max(500).optional(),
})
  .refine((b) => b.startDate.slice(0, 4) === String(b.calendarYear) && b.endDate.slice(0, 4) === String(b.calendarYear), {
    message: "The From and To dates must both be in the year of the target.",
    path: ["startDate"],
  })
  .refine((b) => b.startDate <= b.endDate, {
    message: "The From date is after the To date. Choose a From date that is on or before the To date.",
    path: ["endDate"],
  })
  .refine((b) => isRealDate(b.startDate) && isRealDate(b.endDate), {
    message: "One of the dates is not a real date. Check the day and the month.",
    path: ["startDate"],
  })
export type SetSalesTargetInput = z.infer<typeof setSalesTargetSchema>
