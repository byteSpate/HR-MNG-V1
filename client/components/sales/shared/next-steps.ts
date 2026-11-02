/**
 * Next steps written while a meeting is completed (owner, 2026-11-02). Each
 * line becomes a task linked to that meeting. These two helpers keep the
 * dialog simple: they clean what was typed, and pick a date for a new line.
 */

export interface NextStepLine {
  title: string
  dueOn: string
}

/**
 * The days a follow-up is offered after today. The same number the server uses
 * for the next follow-up after a task is done (`FOLLOW_UP_DAYS` in
 * `task.service.ts`), kept by hand because the client and server share no code.
 */
export const FOLLOW_UP_DAYS = 15

/** Drops lines with no title and trims the rest. Order is kept. */
export function cleanNextSteps(lines: NextStepLine[]): NextStepLine[] {
  return lines
    .map((line) => ({ title: line.title.trim(), dueOn: line.dueOn }))
    .filter((line) => line.title.length > 0)
}

/** Today (YYYY-MM-DD) plus the follow-up days, as YYYY-MM-DD. */
export function defaultNextStepDue(today: string): string {
  const day = new Date(`${today}T00:00:00.000Z`)
  day.setUTCDate(day.getUTCDate() + FOLLOW_UP_DAYS)
  return day.toISOString().slice(0, 10)
}
