/**
 * CSV serialisation, shared by every export in this codebase.
 *
 * Lifted out of `payroll.bankfile.ts`, which had the only implementation. A
 * second hand-rolled one in the attendance reports would be the version nobody
 * tests, and quoting is exactly the thing that looks fine until a beneficiary
 * is called "Rahman, Md." and every later column shifts by one.
 */

/**
 * RFC 4180 quoting: wrap in quotes when the value contains a comma, a quote
 * or a newline, and double any embedded quote.
 */
export function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

/**
 * A whole CSV document, header row included.
 *
 * CRLF line endings, per RFC 4180 — and specifically because Excel on Windows
 * is the reader for almost every export this system produces.
 */
export function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [headers.map(csvCell).join(",")]
  for (const row of rows) lines.push(row.map(csvCell).join(","))
  return lines.join("\r\n")
}
