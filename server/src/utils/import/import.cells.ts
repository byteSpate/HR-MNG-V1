/**
 * Small parsing helpers the importers share, so each one does not write its
 * own "is this a whole number" check.
 */

import type { ZodError } from "zod"

import type { RowIssue } from "./import.types"

/** One cell by header name, trimmed. `parseSheet` stores headers in lower case. */
export function cellText(values: Record<string, string>, header: string): string {
  return (values[header.toLowerCase()] ?? "").trim()
}

/** Strict YYYY-MM-DD that is a real calendar date. */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** A whole number such as 30 or -5. Null for anything else. */
export function parseWholeNumber(raw: string): number | null {
  return /^-?\d+$/.test(raw) ? Number(raw) : null
}

export type YesNo = { ok: true; value: boolean } | { ok: false }

export function parseYesNo(raw: string): YesNo {
  const word = raw.trim().toLowerCase()
  if (["yes", "y", "true", "1"].includes(word)) return { ok: true, value: true }
  if (["no", "n", "false", "0"].includes(word)) return { ok: true, value: false }
  return { ok: false }
}

/**
 * The existing create schemas (Zod) stay the single source of truth for what a
 * valid record is, so an imported record passes the same checks as a typed one.
 * This turns their problems into row issues.
 */
export function zodIssues(rowNumber: number, error: ZodError): RowIssue[] {
  return error.issues.map((issue) => ({
    rowNumber,
    column: issue.path.length > 0 ? String(issue.path[0]) : null,
    message: issue.message,
  }))
}
