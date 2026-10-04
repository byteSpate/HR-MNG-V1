import { toCsv } from "../csv"
import { formatCell } from "./export.format"
import { safeText } from "./export.safe"
import type { ExportSpec } from "./export.types"

/**
 * All columns, UTF-8 with a byte order mark so Excel on Windows reads names in
 * any language correctly. CRLF line endings come from `toCsv`.
 */
export function toCsvFile(spec: ExportSpec): Buffer {
  const headers = spec.columns.map((column) => column.header)
  const rows = spec.rows.map((row) =>
    spec.columns.map((column, index) => {
      const text = formatCell(column, row[index] ?? null)
      return column.type === "text" ? safeText(text) : text
    })
  )
  return Buffer.from(`﻿${toCsv(headers, rows)}`, "utf8")
}
