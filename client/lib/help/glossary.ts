/**
 * One-line definitions for the accounting terms the help copy cannot avoid.
 *
 * Kept deliberately short — this is a reminder, not a lesson. A reader who
 * needs more than one sentence needs a course, not a popover.
 *
 * Terms are marked **on first use in an entry and not again** (see
 * `splitOnTerms`): a paragraph with six dotted underlines is unreadable.
 */

export const GLOSSARY: Record<string, string> = {
  accrual:
    "Recording a cost when it is incurred rather than when it is paid. A bill that arrives after its month is still that month's cost.",
  posting:
    "Turning one business event — a payroll approval, a bill — into its entry in the ledger. A posting is never edited later; it is corrected by reversing it.",
  journal:
    "One entry in the ledger, made up of lines. Every line names an account and an amount on one side, debit or credit.",
  ledger:
    "The full record of every entry the company has made. Reports read the ledger; nothing is ever typed twice.",
  "trial balance":
    "Every account at once, with its opening balance, what came In and went Out, and its closing balance. When the balances add up to zero, the books are square and statements can be produced.",
  debit:
    "The left side of an entry. It holds money going out of an asset or expense account, or into a liability, income or equity account. This is the same way the bank writes a withdrawal.",
  credit:
    "The right side of an entry. It holds money going into an asset or expense account, or out of a liability, income or equity account. This is the same way the bank writes a deposit.",
  "contra account":
    "An account that reduces another account instead of holding money of its own. Accumulated depreciation is the classic one: it sits beside the asset's cost so the net figure shows what the asset is worth.",
  "written-down value":
    "What a fixed asset is worth on the books: what it cost, less the depreciation charged to date.",
  "reducing balance":
    "A way of depreciating: each year a fixed percentage of what is left, rather than a fixed amount of the original cost. The charge gets smaller as the asset ages.",
  reversal:
    "A second entry that undoes a posted one. Both stay on the record — nothing is ever deleted from the ledger.",
  "retained earnings":
    "The accumulated profit or loss the company has kept rather than paid out. The year-end entry sweeps each year's result into it.",
  "opening balance":
    "What an account held at the start of the period it is being read for. On the first year, these are entered by hand; after that they come from the ledger.",
  "financial year":
    "The twelve months the accounts are reported over — for this company, 1 July to 30 June.",
  "accounting period":
    "One of the twelve months inside a financial year. Entries land in the period their date falls in, and a closed period accepts no new ones.",
  comparative:
    "Last year's figure, shown beside this year's so a movement is visible without looking anything up.",
  reconciliation:
    "Checking one record against another — the bank book against the bank statement, or the cash-flow total against the balance sheet — and explaining the difference.",
  "working capital":
    "What the company has available to run on: what customers owe it, plus cash, less what it owes suppliers and staff.",
}

/**
 * Terms, longest first, so "written-down value" matches before "value" could.
 */
export const TERMS = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length)

export type GlossarySegment = string | { term: string; definition: string }

/**
 * Splits a paragraph on glossary terms, marking each term **on its first use
 * only**.
 *
 * `alreadyMarked` is the set of terms this entry has already marked. The
 * caller builds it as it renders each paragraph, so a term that appears in a
 * `does` body and again in a `watchFor` line is underlined once, not twice.
 *
 * Matching is case-insensitive and word-boundary-safe: "accrual" inside
 * "accruals" still matches (both are the reader's word), but "debit" does not
 * match inside "debit-card".
 */
export function splitOnTerms(
  text: string,
  alreadyMarked: Set<string>
): GlossarySegment[] {
  const lower = text.toLowerCase()
  const segments: GlossarySegment[] = []
  let cursor = 0

  while (cursor < text.length) {
    let match: { term: string; index: number } | null = null

    for (const term of TERMS) {
      const idx = lower.indexOf(term, cursor)
      if (idx === -1) continue
      // Word boundary: the character before and after must not be a letter.
      const before = idx === 0 ? "" : lower[idx - 1]
      const after = idx + term.length >= lower.length ? "" : lower[idx + term.length]
      if (/[a-z]/.test(before) || /[a-z]/.test(after)) continue
      if (!match || idx < match.index) match = { term, index: idx }
    }

    if (!match) {
      segments.push(text.slice(cursor))
      break
    }

    if (match.index > cursor) segments.push(text.slice(cursor, match.index))

    const term = match.term
    if (alreadyMarked.has(term)) {
      segments.push(text.slice(match.index, match.index + term.length))
    } else {
      alreadyMarked.add(term)
      segments.push({ term, definition: GLOSSARY[term] })
    }
    cursor = match.index + term.length
  }

  return segments
}
