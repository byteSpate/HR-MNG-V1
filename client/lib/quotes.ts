import type { QuoteBody } from "@/lib/api/types"

/**
 * Small rules for the quote forms (owner, 2026-10-13). The server checks all
 * of it again; this only catches the common mistakes before the round trip.
 */

/** Quotes come newest first; the oldest is Quote 1. */
export function quoteTitle(index: number, total: number): string {
  return `Quote ${total - index}`
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "8 Oct 2026", from "2026-10-08". Read as text, so no time zone moves the day. */
export function longDay(dateOnly: string): string {
  const [y, m, d] = dateOnly.slice(0, 10).split("-").map(Number)
  return `${d} ${SHORT_MONTHS[m - 1]} ${y}`
}

/** Today in the viewer's calendar, as YYYY-MM-DD. */
export function todayIso(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export interface QuoteDraft {
  amount: string
  quotedOn: string
  reference: string
  note: string
}

export function emptyQuoteDraft(): QuoteDraft {
  return { amount: "", quotedOn: todayIso(), reference: "", note: "" }
}

/** What the form sends, or the first thing to fix. */
export function quoteBodyOf(draft: QuoteDraft, today: string): { body: QuoteBody } | { error: string } {
  const amount = draft.amount.replace(/[,\s]/g, "")
  if (!amount) return { error: "Write the quote amount." }
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(amount)) return { error: "Write the amount as a number, like 1200000 or 1200000.50." }
  if (!draft.quotedOn) return { error: "Pick the quote date." }
  if (draft.quotedOn > today) return { error: "A quote date cannot be in the future." }
  return {
    body: {
      amount,
      quotedOn: draft.quotedOn,
      reference: draft.reference.trim() || null,
      note: draft.note.trim() || null,
    },
  }
}
