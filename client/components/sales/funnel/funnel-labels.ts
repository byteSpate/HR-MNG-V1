/**
 * The funnel's name column. It was headed "Project Name" on the team's sheet,
 * but a Project is now its own record (ADR 0005), and the funnel lists an
 * Opportunity only after its quotation or proposal has been sent.
 */
export const FUNNEL_NAME_HEADING = "Opportunity name"

export const FUNNEL_NAME_HELP =
  "The name of the Opportunity. The funnel lists an Opportunity only after its quotation or proposal has been sent."

/** Days to the closing date, in plain words (owner, 2026-10-13). */
export function daysLeftText(days: number | null): string {
  if (days === null) return "No date"
  if (days === 0) return "Today"
  if (days < 0) return `Overdue ${-days} ${-days === 1 ? "day" : "days"}`
  return `${days} ${days === 1 ? "day" : "days"}`
}

/** The strip's Coverage tile. Missing facts are words, never 0×. */
export function coverageText(s: { coverage: string | null; targetMet: boolean; target: string | null }): string {
  if (s.targetMet) return "Target met"
  if (s.target === null) return "No target set"
  if (s.coverage === null) return "No open quotes"
  return `${s.coverage}×`
}

/** The quarter picker: this quarter, the next, then the rest of this year's. */
export function quarterOptions(now: Date): { value: string; label: string }[] {
  const year = now.getFullYear()
  const quarter = Math.floor(now.getMonth() / 3) + 1
  const next = quarter === 4 ? { year: year + 1, quarter: 1 } : { year, quarter: quarter + 1 }
  const value = (y: number, q: number) => `${y}-Q${q}`
  const rest = [1, 2, 3, 4]
    .filter((q) => q !== quarter && !(next.year === year && next.quarter === q))
    .map((q) => ({ value: value(year, q), label: `Q${q} ${year}` }))
  return [
    { value: value(year, quarter), label: `This quarter (Q${quarter} ${year})` },
    { value: value(next.year, next.quarter), label: `Next quarter (Q${next.quarter} ${next.year})` },
    ...rest,
  ]
}
