import { formatDateOnly } from "../dates"
import type { ExportColumn, ExportValue } from "./export.types"

/** One cell as plain text, for CSV and PDF. Excel keeps real types instead. */
export function formatCell(column: ExportColumn, value: ExportValue): string {
  if (value === null || value === undefined) return ""
  switch (column.type) {
    case "text":
      return String(value)
    case "integer":
      return String(Math.trunc(Number(value)))
    case "decimal":
      return Number(value).toFixed(column.decimals ?? 2)
    case "date":
      return value instanceof Date ? formatDateOnly(value) : String(value)
    case "boolean":
      return value ? "Yes" : "No"
  }
}
