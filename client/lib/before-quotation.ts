/**
 * Small pure helpers for the Before Quotation view (owner, 2026-11-02): how
 * long an Opportunity has sat in its stage, what its next step says, and
 * whether the day it plans to send the quote is near or gone.
 */

const MS_PER_DAY = 86_400_000

/** "Quote due soon" looks this many days ahead. The server counts the same number. */
export const QUOTE_DUE_DAYS = 14

/** Whole days since the stage last changed. Never negative. */
export function daysInStage(stageChangedAt: string, now: Date): number {
  const days = Math.floor((now.getTime() - new Date(stageChangedAt).getTime()) / MS_PER_DAY)
  return Math.max(0, days)
}

/**
 * The Opportunity's own next step and its day. An empty step is null, so the
 * screen can say "No next step" in one place and in plain words.
 */
export function nextStepParts(opp: { nextStep: string | null; nextStepDueOn: string | null }): {
  text: string | null
  dueOn: string | null
} {
  const text = opp.nextStep?.trim() ? opp.nextStep.trim() : null
  return text ? { text, dueOn: opp.nextStepDueOn } : { text: null, dueOn: null }
}

/**
 * Where the expected quote day stands against today (both YYYY-MM-DD):
 * none (not set), late (passed), soon (today up to the due-soon days) or later.
 */
export function quoteDueState(expectedQuoteOn: string | null, today: string): "none" | "late" | "soon" | "later" {
  if (!expectedQuoteOn) return "none"
  if (expectedQuoteOn < today) return "late"
  const limit = new Date(`${today}T00:00:00.000Z`)
  limit.setUTCDate(limit.getUTCDate() + QUOTE_DUE_DAYS)
  return expectedQuoteOn <= limit.toISOString().slice(0, 10) ? "soon" : "later"
}
