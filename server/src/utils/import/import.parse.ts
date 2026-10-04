/**
 * Reading a spreadsheet into rows of strings.
 *
 * `exceljs` reads .csv as well as .xlsx, so one library covers both formats
 * and there is no second parser to keep consistent.
 *
 * Only the **first worksheet** is read and a header row is **required**.
 * Guessing at a sheet or at column order is how an import silently loads the
 * wrong column into a cost field.
 *
 * Everything comes out as a trimmed string. Type coercion is the caller's
 * job, because "is this a date" depends on the column, and a parser that
 * guesses turns a bad cell into a plausible wrong value instead of an error.
 */

import ExcelJS from "exceljs"

import { AppError } from "../../middleware/errorHandler"
import type { ParsedRow } from "./import.types"

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) {
    // Excel stores a time of day such as 09:00 as a date in 1899. Read as a
    // date it gave "1899-12-30", so a typed shift time failed its check.
    if (value.getUTCFullYear() < 1900) return value.toISOString().slice(11, 16)
    return value.toISOString().slice(0, 10)
  }
  if (typeof value === "object") {
    // exceljs boxes formulas as { result }, rich text as { richText: [...] },
    // and hyperlinks as { text }. Reading `.toString()` on these yields
    // "[object Object]", which would import as a literal cell value.
    const v = value as { result?: unknown; text?: string; richText?: { text: string }[] }
    if (v.richText) return v.richText.map((r) => r.text).join("")
    if (v.text !== undefined) return String(v.text)
    if (v.result !== undefined) return String(v.result)
    return ""
  }
  return String(value)
}

export async function parseSheet(buffer: Buffer, fileName: string): Promise<ParsedRow[]> {
  const wb = new ExcelJS.Workbook()
  if (fileName.toLowerCase().endsWith(".csv")) {
    // exceljs's csv reader wants a stream; a Buffer is not one.
    const { Readable } = await import("node:stream")
    // `map` keeps every cell as the text that was typed. By default exceljs turns
    // "0123456789" into 123456789, "+8801711000000" into 8801711000000, and
    // "2026-12-16" into a local-time date that reads back a day early in a
    // timezone ahead of UTC. A BIN, a phone number and a date must survive.
    await wb.csv.read(Readable.from(buffer), { map: (value: unknown) => value })
  } else {
    // exceljs's bundled .d.ts shadows `Buffer` with a bare `extends
    // ArrayBuffer` interface local to that module, which newer @types/node's
    // generic `Buffer<ArrayBufferLike>` doesn't structurally satisfy (a
    // known exceljs typing bug, not a real runtime mismatch — exceljs reads
    // Node Buffers fine).
    await wb.xlsx.load(buffer as unknown as ArrayBuffer)
  }

  const ws = wb.worksheets[0]
  if (!ws || ws.rowCount === 0) {
    throw new AppError(400, "The file has no header row")
  }

  const headerRow = ws.getRow(1)
  const headers: string[] = []
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = cellText(cell.value).trim().toLowerCase()
  })
  if (headers.filter(Boolean).length === 0) {
    throw new AppError(400, "The file has no header row")
  }

  const rows: ParsedRow[] = []
  for (let n = 2; n <= ws.rowCount; n += 1) {
    const row = ws.getRow(n)
    const values: Record<string, string> = {}
    headers.forEach((header, col) => {
      if (!header) return
      values[header] = cellText(row.getCell(col).value).trim()
    })
    // A wholly blank line is trailing whitespace in the file, not a row the
    // user meant to import — flagging it as an error would make every
    // spreadsheet saved from Excel fail.
    if (Object.values(values).every((v) => v === "")) continue
    rows.push({ rowNumber: n, values })
  }

  return rows
}
