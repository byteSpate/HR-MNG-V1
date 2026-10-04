import ExcelJS from "exceljs"

import { formatCell } from "./export.format"
import { safeText } from "./export.safe"
import type { ExportColumn, ExportSpec, ExportValue } from "./export.types"

/** Excel refuses these in a sheet name and caps the name at 31 characters. */
function sheetName(title: string): string {
  const cleaned = title.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31)
  return cleaned || "Export"
}

function numberFormat(column: ExportColumn): string | undefined {
  if (column.type === "integer") return "0"
  if (column.type === "date") return "yyyy-mm-dd"
  if (column.type === "decimal") {
    const digits = column.decimals ?? 2
    return digits === 0 ? "#,##0" : `#,##0.${"0".repeat(digits)}`
  }
  return undefined
}

function cellValue(column: ExportColumn, value: ExportValue): ExcelJS.CellValue {
  if (value === null || value === undefined) return null
  switch (column.type) {
    case "text":
      return safeText(String(value))
    case "integer":
    case "decimal":
      return Number(value)
    case "date":
      return value instanceof Date ? value : String(value)
    case "boolean":
      return value ? "Yes" : "No"
  }
}

/** All columns. Real numbers and real dates, a frozen header row and a filter. */
export async function toXlsx(spec: ExportSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheetName(spec.title))

  ws.addRow(spec.columns.map((column) => column.header))
  for (const row of spec.rows) {
    ws.addRow(spec.columns.map((column, index) => cellValue(column, row[index] ?? null)))
  }

  const header = ws.getRow(1)
  header.font = { bold: true }
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE3E7EF" } }

  spec.columns.forEach((column, index) => {
    const sheetColumn = ws.getColumn(index + 1)
    const format = numberFormat(column)
    if (format) sheetColumn.numFmt = format
    const longest = spec.rows.reduce(
      (max, row) => Math.max(max, formatCell(column, row[index] ?? null).length),
      column.header.length
    )
    sheetColumn.width = Math.min(50, Math.max(10, longest + 2))
  })

  ws.views = [{ state: "frozen", ySplit: 1 }]
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spec.columns.length } }

  return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer)
}
