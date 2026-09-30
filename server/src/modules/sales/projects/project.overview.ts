const MS_DAY = 86_400_000

/** A Project in progress with no update for this many days has "gone quiet" (spec 2026-09-30). */
export const QUIET_AFTER_DAYS = 7

type MaybeDate = Date | null | undefined

/** The newest of these times, or null when there are none. */
export function latestOf(times: MaybeDate[]): Date | null {
  let best: Date | null = null
  for (const time of times) {
    if (time && (!best || time.getTime() > best.getTime())) best = time
  }
  return best
}

/**
 * When something last happened on a Project. Any of these counts: a Daily Log
 * line, a change to a task, a milestone ticked, a product ticked, or a change
 * to the Project itself. The Project's own `updatedAt` is always there, so the
 * answer is never empty.
 */
export function lastUpdateOf(input: {
  projectUpdatedAt: Date
  logs: MaybeDate[]
  tasks: MaybeDate[]
  milestonesDoneAt: MaybeDate[]
  lineTicks: MaybeDate[]
}): Date {
  return (
    latestOf([input.projectUpdatedAt, ...input.logs, ...input.tasks, ...input.milestonesDoneAt, ...input.lineTicks]) ??
    input.projectUpdatedAt
  )
}

/**
 * Whole days of silence when the Project has gone quiet, else null. Only a
 * Project in progress can go quiet: a Blocked or On hold Project is expected
 * to be still, and one not yet started has nothing to report.
 */
export function quietDaysOf(status: string, lastUpdate: Date, now: Date): number | null {
  if (status !== "IN_PROGRESS") return null
  const days = Math.floor((now.getTime() - lastUpdate.getTime()) / MS_DAY)
  return days >= QUIET_AFTER_DAYS ? days : null
}

/**
 * Days from `today` to the finish date, negative once it has passed. Null with
 * no finish date, and for a Project that is finished: "days left" on a
 * Completed Project would be a number about nothing. Both dates are date-only
 * at UTC midnight, the convention the rest of the Sales Hub uses.
 */
export function daysLeftOf(dueOn: Date | null, status: string, today: Date): number | null {
  if (!dueOn || status === "COMPLETED" || status === "CANCELLED") return null
  return Math.round((dueOn.getTime() - today.getTime()) / MS_DAY)
}
