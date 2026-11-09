import { formatAmount, formatSigned, formatTotal } from "@/components/accounting/accounting-shared"

export type AmountTone = "neutral" | "danger" | "success" | "muted"
export type AmountMode = "amount" | "total" | "signed"

const TONE: Record<AmountTone, string> = {
  neutral: "text-ink",
  danger: "text-danger",
  success: "text-success",
  muted: "text-ink-muted",
}

/** Right aligned, tabular figures, never wraps. */
export const amountClass = (tone: AmountTone = "neutral"): string =>
  `text-right tabular-nums whitespace-nowrap ${TONE[tone]}`

/**
 * Formats a decimal string for display. It never does arithmetic.
 * "amount" shows a dash for zero. "total" always shows a figure. "signed" shows a loss in brackets.
 */
export function formatMoney(value: string, mode: AmountMode = "amount"): string {
  if (mode === "total") return formatTotal(value)
  if (mode === "signed") return formatSigned(value)
  return formatAmount(value)
}

export interface LinesColumn {
  key: string
  label: string
  /** Width on a wide screen, as a CSS grid track, for example "1fr" or "8rem". */
  width?: string
  align?: "left" | "right"
  /** On a phone the cell takes the whole card width instead of half. */
  fullOnPhone?: boolean
  /** Extra classes for the column label only, for example a color. */
  labelClassName?: string
}

export function isEmptyCell(value: unknown): boolean {
  return value === null || value === undefined || value === false || value === ""
}

/** A row as labelled pairs, in column order. Empty cells are left out. */
export function toCards(
  columns: ReadonlyArray<Pick<LinesColumn, "key" | "label">>,
  row: Record<string, unknown>,
): Array<{ label: string; value: unknown }> {
  return columns
    .filter((c) => !isEmptyCell(row[c.key]))
    .map((c) => ({ label: c.label, value: row[c.key] }))
}

/** The wide-screen grid template, from the column widths. */
export const gridTemplate = (columns: ReadonlyArray<Pick<LinesColumn, "width">>): string =>
  columns.map((c) => c.width ?? "1fr").join(" ")
