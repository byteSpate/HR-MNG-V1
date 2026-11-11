/**
 * A report is a filtered list shown on the Reports page, with the same rows
 * downloadable as Excel, CSV or PDF.
 *
 * One builder per report makes an `ExportSpec`. This file sends it: as JSON
 * for the screen, or as a file through `sendExport` (which writes the audit
 * row). Screen and file read the same rows, so they cannot disagree.
 */

import type { Response } from "express"

import { AppError } from "../../middleware/errorHandler"
import type { AccessTokenPayload } from "../../modules/auth/auth.types"
import { MS_PER_DAY, parseDateOnly } from "../dates"
import { parseExportFormat, sendExport } from "./export.respond"
import type { ExportFormat, ExportSpec } from "./export.types"

export type ReportFormat = ExportFormat | "json"

/** One number shown above the table, for example "Approved days: 12". */
export interface ReportSummaryItem {
  label: string
  value: string
}

/** What the screen gets. Dates in `rows` arrive as ISO strings. */
export interface ReportPayload extends Pick<ExportSpec, "title" | "filterNote" | "columns" | "rows"> {
  summary: ReportSummaryItem[]
}

/** No format means the screen is asking. */
export function parseReportFormat(value: unknown): ReportFormat {
  if (value === undefined || value === "json") return "json"
  return parseExportFormat(value)
}

export interface SendReportArgs {
  res: Response
  spec: ExportSpec
  format: ReportFormat
  /** `leave-report` gives `leave-report-2026-11-11.xlsx`. */
  baseName: string
  actor: AccessTokenPayload
  /** The audit row's entityId. */
  list: string
  filter?: Record<string, unknown>
  summary: ReportSummaryItem[]
}

export async function sendReport(args: SendReportArgs): Promise<void> {
  const { res, spec, format, summary, ...file } = args
  if (format === "json") {
    // Looking at a report on screen is not an export, so no audit row.
    const payload: ReportPayload = {
      title: spec.title,
      filterNote: spec.filterNote,
      columns: spec.columns,
      rows: spec.rows,
      summary,
    }
    res.status(200).json(payload)
    return
  }
  await sendExport({ res, spec, format, ...file })
}

/** Two years, the same ceiling as the expense report. */
const MAX_REPORT_DAYS = 732

/** A From and To date (YYYY-MM-DD), both kept. */
export function resolveReportRange(from: string, to: string): { start: Date; end: Date } {
  let start: Date
  let end: Date
  try {
    start = parseDateOnly(from)
    end = parseDateOnly(to)
  } catch {
    throw new AppError(400, "Pick a real date for From and To.")
  }
  if (end.getTime() < start.getTime()) {
    throw new AppError(400, "The To date is before the From date. Pick a later To date.")
  }
  if (Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1 > MAX_REPORT_DAYS) {
    throw new AppError(400, "A report can cover at most 2 years. Pick a shorter range.")
  }
  return { start, end }
}

export interface YearMonth {
  year: number
  month: number
}

const MAX_MONTHS = 36

function parseMonth(value: string): YearMonth {
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  const month = match ? Number(match[2]) : 0
  if (!match || month < 1 || month > 12) throw new AppError(400, "Pick a real month for From and To.")
  return { year: Number(match[1]), month }
}

/** A From and To month (YYYY-MM), both kept. */
export function resolveMonthRange(from: string, to: string): { from: YearMonth; to: YearMonth } {
  const a = parseMonth(from)
  const b = parseMonth(to)
  const span = (b.year * 12 + b.month) - (a.year * 12 + a.month) + 1
  if (span < 1) throw new AppError(400, "The To month is before the From month. Pick a later To month.")
  if (span > MAX_MONTHS) {
    throw new AppError(400, `A payroll report can cover at most ${MAX_MONTHS} months. Pick a shorter range.`)
  }
  return { from: a, to: b }
}
