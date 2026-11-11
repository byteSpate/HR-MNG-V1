import { apiFetch, apiFetchBlob } from "./client"
import { buildQuery, type ExportFormat, type QueryValue } from "./import-export"

/**
 * The Employee, Leave and Payroll reports. The server sends one shape for
 * all three, and the same rows go into the Excel, CSV and PDF files.
 */

export type ReportCellType = "text" | "integer" | "decimal" | "date" | "boolean"
export type ReportValue = string | number | boolean | null

export interface ReportColumn {
  header: string
  pdfHeader?: string
  type: ReportCellType
  decimals?: number
  /** A main column. The screen and the PDF show only these. */
  inPdf?: boolean
}

export interface ReportPayload {
  title: string
  filterNote?: string
  columns: ReportColumn[]
  /** Dates arrive as ISO strings. */
  rows: ReportValue[][]
  summary: { label: string; value: string }[]
}

export function getReport(
  accessToken: string, path: string, params: Record<string, QueryValue>,
): Promise<ReportPayload> {
  return apiFetch<ReportPayload>(`${path}${buildQuery(params)}`, { accessToken })
}

export async function downloadReport(
  accessToken: string, path: string, params: Record<string, QueryValue>, format: ExportFormat,
): Promise<Blob> {
  const { blob } = await apiFetchBlob(`${path}${buildQuery({ ...params, format })}`, { accessToken })
  return blob
}

/** The columns the screen shows, with where each sits in a row. */
export function screenColumns(payload: ReportPayload): { index: number; label: string; column: ReportColumn }[] {
  const all = payload.columns.map((column, index) => ({ index, label: column.pdfHeader ?? column.header, column }))
  const main = all.filter((c) => c.column.inPdf)
  return main.length > 0 ? main : all
}

export function formatReportCell(value: ReportValue, column: Pick<ReportColumn, "type" | "decimals">): string {
  if (value === null || value === undefined || value === "") return ""
  switch (column.type) {
    case "date":
      return String(value).slice(0, 10)
    case "decimal": {
      const digits = column.decimals ?? 2
      return Number(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    }
    case "integer":
      return Number(value).toLocaleString("en-US")
    case "boolean":
      return value ? "Yes" : "No"
    default:
      return String(value)
  }
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/** The last `count` months, newest first, as `{ value: "2026-02", label: "February 2026" }`. */
export function monthOptions(today: Date, count: number): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = []
  for (let i = 0; i < count; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    out.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    })
  }
  return out
}
