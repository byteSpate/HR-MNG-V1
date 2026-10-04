/**
 * Preview and commit, shared by every bulk importer.
 *
 * The shape is payroll's preflight-then-process pointed at a file:
 * `runPreview` writes nothing, ever; `runCommit` hands the caller every row
 * at once so the caller can write them in a single transaction.
 *
 * **All-or-nothing per file.** A partially imported register is worse than an
 * empty one — you cannot tell which rows landed, so re-running duplicates and
 * not re-running leaves gaps. That is `payroll.bankfile.ts`'s
 * validate-then-emit rule pointed the other way, and the preview is its
 * manifest: naming every bad row first is what makes the strictness
 * tolerable.
 */

import { AppError } from "../../middleware/errorHandler"
import { parseSheet } from "./import.parse"
import { MAX_IMPORT_ROWS, type ColumnSpec, type ImportPreview, type ParsedRow, type RowIssue } from "./import.types"

export interface ImportSpec<T> {
  columns: ColumnSpec[]
  validateRow(row: ParsedRow): { ok: true; value: T } | { ok: false; issues: RowIssue[] }
  /** Cross-row and database checks the row-by-row pass cannot see. */
  validateAll?(rows: T[]): Promise<RowIssue[]>
  summarise?(rows: T[]): Record<string, number>
}

/** Row 1 is the header, so a whole-file problem is reported against it. */
const HEADER_ROW = 1

function presentHeaders(rows: ParsedRow[]): Set<string> {
  // Headers come from the file, so an empty file cannot prove a column is
  // absent — and reporting all of them as missing would bury the real error.
  return new Set(Object.keys(rows[0]?.values ?? {}))
}

function missingColumns(columns: ColumnSpec[], present: Set<string>): RowIssue[] {
  if (present.size === 0) return []
  return columns
    .filter((c) => c.required && !present.has(c.header.toLowerCase()))
    .map((c) => ({
      rowNumber: HEADER_ROW,
      column: c.header,
      message: `Required column "${c.header}" is missing`,
    }))
}

function requiredValueIssues(row: ParsedRow, columns: ColumnSpec[], present: Set<string>): RowIssue[] {
  // A column missing from the whole file is `missingColumns`'s issue to
  // report once, against the header — not this row's to repeat for every
  // row, which would bury the one real error under N duplicates of it.
  return columns
    .filter((c) => c.required && present.has(c.header.toLowerCase()))
    .filter((c) => (row.values[c.header.toLowerCase()] ?? "") === "")
    .map((c) => ({
      rowNumber: row.rowNumber,
      column: c.header,
      message: `${c.header} is required`,
    }))
}

function duplicateIssues(rows: ParsedRow[], columns: ColumnSpec[]): RowIssue[] {
  const issues: RowIssue[] = []
  for (const column of columns.filter((c) => c.uniqueInFile)) {
    const key = column.header.toLowerCase()
    const seen = new Map<string, number[]>()
    for (const row of rows) {
      const value = row.values[key] ?? ""
      // Many rows legitimately have no serial — furniture, licences. Only a
      // repeated *non-empty* value is a contradiction.
      if (value === "") continue
      const at = seen.get(value) ?? []
      at.push(row.rowNumber)
      seen.set(value, at)
    }
    for (const [value, at] of seen) {
      if (at.length < 2) continue
      // Every offending row, not just the later ones: the user cannot tell
      // which of two identical rows is the mistake without seeing both.
      for (const rowNumber of at) {
        issues.push({
          rowNumber,
          column: column.header,
          message: `Duplicate ${column.header} "${value}" in this file (rows ${at.join(", ")})`,
        })
      }
    }
  }
  return issues
}

export async function runPreview<T>(
  buffer: Buffer,
  fileName: string,
  spec: ImportSpec<T>
): Promise<ImportPreview<T>> {
  const parsed = await parseSheet(buffer, fileName)
  if (parsed.length > MAX_IMPORT_ROWS) {
    throw new AppError(
      400,
      `This file has too many rows. Split it into files of ${MAX_IMPORT_ROWS.toLocaleString("en-US")} rows or less.`
    )
  }
  const present = presentHeaders(parsed)

  const issues: RowIssue[] = [
    ...missingColumns(spec.columns, present),
    ...duplicateIssues(parsed, spec.columns),
  ]

  const values: T[] = []
  for (const row of parsed) {
    const required = requiredValueIssues(row, spec.columns, present)
    if (required.length > 0) {
      issues.push(...required)
      continue
    }
    const result = spec.validateRow(row)
    if (result.ok) values.push(result.value)
    else issues.push(...result.issues)
  }

  // Only run the database pass over rows that parsed. Handing it half-built
  // rows would produce errors about problems the user never made.
  if (spec.validateAll && issues.length === 0) {
    issues.push(...(await spec.validateAll(values)))
  }

  return {
    rows: values,
    issues: issues.sort((a, b) => a.rowNumber - b.rowNumber),
    summary: spec.summarise?.(values) ?? { rows: values.length },
  }
}

export async function runCommit<T, R>(
  buffer: Buffer,
  fileName: string,
  spec: ImportSpec<T>,
  write: (rows: T[]) => Promise<R>
): Promise<R> {
  const preview = await runPreview(buffer, fileName, spec)
  if (preview.issues.length > 0) {
    throw new AppError(400, `${preview.issues.length} row(s) have errors`, {
      issues: preview.issues,
    })
  }
  try {
    return await write(preview.rows)
  } catch (err) {
    // Two people importing the same name at once: the preview said it was free,
    // the database says it is not. Say what happened and what to do.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      throw new AppError(409, "Someone added one of these records while you were importing. Run the preview again.")
    }
    throw err
  }
}
