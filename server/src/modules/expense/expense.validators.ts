import { z } from "zod"

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")

export const createClaimBody = z.object({
  amount: z.coerce.number().positive("amount must be greater than 0"),
  categoryId: z.string().uuid(),
  currency: z.enum(["BDT", "USD"]).default("BDT"),
  // When the money was spent — distinct from when it was claimed. You submit
  // a July taxi fare in August, and it must be judged on the July date.
  expenseDate: dateOnly,
  description: z.string().max(1000).optional(),
  receiptUrl: z.string().max(2000).optional(),
  /**
   * Where a journey started and ended. Optional at this layer because only
   * travel and conveyance claims have a route — a stationery bill does not —
   * and the category that decides "travel" is a row in a table Finance edits,
   * not a constant this schema could branch on.
   */
  travelFrom: z.string().trim().max(200).optional(),
  travelTo: z.string().trim().max(200).optional(),
})
export type CreateClaimBody = z.infer<typeof createClaimBody>

/** A note is required on reject, matching leave and attendance. */
export const rejectClaimBody = z.object({
  note: z.string().min(1, "A note is required").max(1000),
})
export type RejectClaimBody = z.infer<typeof rejectClaimBody>

export const approveClaimBody = z.object({
  note: z.string().max(1000).optional(),
})
export type ApproveClaimBody = z.infer<typeof approveClaimBody>

/**
 * `from` and `to` are required, unlike `claimQuery`: a report defaulting to
 * some server-chosen range would put a date on a printed document that nobody
 * asked for.
 */
export const reportQuery = z.object({
  from: dateOnly,
  to: dateOnly,
  /** Ignored for staff, who always get their own — see `expense.report.ts`. */
  employeeId: z.string().min(1).optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "REIMBURSED"]).optional(),
  /** `csv` and `pdf` switch the response from JSON to a file download. */
  format: z.enum(["json", "csv", "pdf"]).default("json"),
})
export type ReportQuery = z.infer<typeof reportQuery>

export const claimQuery = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "REIMBURSED"]).optional(),
  employeeId: z.string().optional(),
})
export type ClaimQuery = z.infer<typeof claimQuery>
