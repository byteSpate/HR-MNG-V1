import { z } from "zod"

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")
const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Expected an HH:mm office-local time")

export const dateRangeQuerySchema = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
})
export type DateRangeQuery = z.infer<typeof dateRangeQuerySchema>

export const dailyQuerySchema = z.object({
  date: dateOnly.optional(),
})
export type DailyQuery = z.infer<typeof dailyQuerySchema>

export const monthQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
})
export type MonthQuery = z.infer<typeof monthQuerySchema>

export const yearQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
})
export type YearQuery = z.infer<typeof yearQuerySchema>

/**
 * `from` and `to` are required here, unlike `dateRangeQuerySchema`: a report
 * defaulting to some server-chosen range would put a date on a printed
 * document that nobody asked for.
 */
export const reportQuerySchema = z.object({
  from: dateOnly,
  to: dateOnly,
  granularity: z.enum(["summary", "daily"]).default("summary"),
  employeeId: z.string().min(1).optional(),
  /**
   * `csv` and `pdf` switch the response from JSON to a file download. PDF is
   * the printable document; CSV is the same report for a spreadsheet.
   */
  format: z.enum(["json", "csv", "pdf"]).default("json"),
})
export type ReportQuery = z.infer<typeof reportQuerySchema>

export const approvalsQuerySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  minAgingDays: z.coerce.number().int().min(0).max(365).optional(),
})
export type ApprovalsQuery = z.infer<typeof approvalsQuerySchema>

/**
 * The three write paths that set times all share a shape. Times are
 * office-local HH:mm — the client never sends an instant, because a browser
 * clock is spoofable and wrong the moment someone opens the app abroad.
 */
const timeAmendment = z.object({
  checkIn: timeOfDay.optional(),
  checkOut: timeOfDay.optional(),
  note: z.string().min(1, "A note is required").max(500),
})

const hasATime = (body: { checkIn?: string; checkOut?: string }) =>
  body.checkIn !== undefined || body.checkOut !== undefined

const AT_LEAST_ONE_TIME = {
  message: "Provide a check-in or check-out time",
  path: ["checkOut"],
}

/** The employee amending their own record. */
export const regulariseSchema = timeAmendment
  .extend({ note: z.string().min(1, "A reason is required").max(500) })
  .refine(hasATime, AT_LEAST_ONE_TIME)
export type RegulariseBody = z.infer<typeof regulariseSchema>

/** HR editing someone else's record. */
export const correctionSchema = timeAmendment.refine(hasATime, AT_LEAST_ONE_TIME)
export type CorrectionBody = z.infer<typeof correctionSchema>

/** HR entering a day that has no record at all. */
export const manualAttendanceSchema = timeAmendment
  .extend({ employeeId: z.string().min(1), date: dateOnly })
  .refine(hasATime, AT_LEAST_ONE_TIME)
export type ManualAttendanceBody = z.infer<typeof manualAttendanceSchema>

/** Approving needs no explanation; rejecting always does. */
export const approveSchema = z.object({
  note: z.string().max(500).optional(),
})
export type ApproveBody = z.infer<typeof approveSchema>

export const rejectSchema = z.object({
  note: z.string().min(1, "A reason is required").max(500),
})
export type RejectBody = z.infer<typeof rejectSchema>

export const bulkDecisionSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1, "Select at least one record").max(500),
    decision: z.enum(["APPROVE", "REJECT"]),
    note: z.string().max(500).optional(),
  })
  .refine((body) => body.decision === "APPROVE" || (body.note?.trim().length ?? 0) > 0, {
    message: "A reason is required when rejecting",
    path: ["note"],
  })
export type BulkDecisionBody = z.infer<typeof bulkDecisionSchema>

export const holidaySchema = z.object({
  name: z.string().min(1, "A name is required").max(200),
  date: dateOnly,
  type: z.enum(["GENERAL", "EXECUTIVE_ORDER", "OPTIONAL", "WORKING_DAY"]).default("GENERAL"),
})
export type HolidayBody = z.infer<typeof holidaySchema>

export const holidayUpdateSchema = holidaySchema.partial().refine(
  (body) => Object.values(body).some((value) => value !== undefined),
  { message: "Provide at least one field to update" }
)
export type HolidayUpdateBody = z.infer<typeof holidayUpdateSchema>

/**
 * 0=Sun … 6=Sat, matching `Shift.weeklyOffDays`. Deduplicated so [5,5] cannot
 * make a day count twice anywhere downstream.
 */
const weeklyOffDays = z
  .array(z.number().int().min(0).max(6))
  .max(7)
  .transform((days) => [...new Set(days)].sort((a, b) => a - b))

/** The field shapes, without defaults, so the update schema can reuse them. */
const shiftFields = {
  name: z.string().trim().min(1, "A name is required").max(100),
  startTime: timeOfDay,
  endTime: timeOfDay,
  breakMinutes: z.coerce.number().int().min(0).max(480),
  graceMinutes: z.coerce.number().int().min(0).max(240),
  weeklyOffDays,
}

export const shiftSchema = z.object({
  ...shiftFields,
  breakMinutes: shiftFields.breakMinutes.default(60),
  graceMinutes: shiftFields.graceMinutes.default(15),
  weeklyOffDays: shiftFields.weeklyOffDays.default([5]),
})
export type ShiftBody = z.infer<typeof shiftSchema>

/**
 * Built from the defaults-free field set, NOT from `shiftSchema.partial()`.
 *
 * `.partial()` makes a field optional but keeps its `.default()`, so a PATCH
 * carrying only `startTime` would also write breakMinutes 60, graceMinutes 15
 * and weeklyOffDays [5] — silently resetting a shift's rest days, which
 * re-derives every past attendance day for everyone on it.
 */
export const shiftUpdateSchema = z
  .object(shiftFields)
  .partial()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Provide at least one field to update",
  })
export type ShiftUpdateBody = z.infer<typeof shiftUpdateSchema>
