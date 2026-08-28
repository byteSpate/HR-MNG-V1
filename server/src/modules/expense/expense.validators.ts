import { z } from "zod"

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")

export const createClaimBody = z.object({
  /**
   * Required here even though the column is nullable. The column allows null
   * only because claims predate it; nothing new should be filed without a
   * name, since a category alone cannot tell two claims apart.
   */
  name: z.string().trim().min(1, "Give the expense a name").max(200),
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
 * A sweep of approvals.
 *
 * No `note`, deliberately — one sentence glued to twelve different claims is
 * the same defect that ruled out bulk reject. The note stays on single
 * approve, where it can be about the claim it is attached to.
 *
 * Capped at 200: the batch is a loop of transactions, each posting to the
 * ledger, and an uncapped list is a request that holds a connection open for
 * as long as somebody cares to make it.
 */
export const approveClaimsBody = z.object({
  claimIds: z.array(z.string().uuid()).min(1, "Select at least one claim").max(200),
})
export type ApproveClaimsBody = z.infer<typeof approveClaimsBody>

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

/**
 * Editing a claim you have already filed.
 *
 * Every field optional — a PATCH — but `categoryId` and `currency` are here
 * for a reason: correcting the category is the commonest edit, and a claim
 * filed in the wrong currency is wrong by a factor of a hundred.
 *
 * `expenseDate` is editable too, since the whole point of the field is that
 * you claim in August for something bought in July and may have typed the
 * wrong July date.
 */
export const updateClaimBody = z
  .object({
    name: z.string().trim().min(1, "Give the expense a name").max(200).optional(),
    amount: z.coerce.number().positive("amount must be greater than 0").optional(),
    categoryId: z.string().uuid().optional(),
    currency: z.enum(["BDT", "USD"]).optional(),
    expenseDate: dateOnly.optional(),
    // Nullable, unlike the others: clearing a note is a real edit, and an
    // omitted key has to keep meaning "leave it alone".
    description: z.string().max(1000).nullable().optional(),
    travelFrom: z.string().trim().max(200).nullable().optional(),
    travelTo: z.string().trim().max(200).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Nothing to change",
  })
export type UpdateClaimBody = z.infer<typeof updateClaimBody>
