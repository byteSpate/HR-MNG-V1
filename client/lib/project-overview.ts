import type { Tone } from "@/components/dashboard/types"

/**
 * The words and counts behind the Projects page and the Overview tab (spec
 * 2026-09-30). Pure, so they are tested without a screen. The numbers
 * themselves (health, days left, quiet days) come from the server, so the list
 * and the tab cannot disagree; this file only says them in easy words.
 */

export type ProjectHealth = "ON_TRACK" | "AT_RISK" | "LATE"

export const HEALTH_LABEL: Record<ProjectHealth, string> = {
  ON_TRACK: "On track",
  AT_RISK: "At risk",
  LATE: "Late",
}

export const HEALTH_TONE: Record<ProjectHealth, Tone> = {
  ON_TRACK: "green",
  AT_RISK: "yellow",
  LATE: "red",
}

/** "7 days left", "Due today", "3 days late", "No finish date", or "Finished". */
export function daysLeftText(daysLeft: number | null, status: string): string {
  if (daysLeft === null) return status === "COMPLETED" || status === "CANCELLED" ? "Finished" : "No finish date"
  if (daysLeft === 0) return "Due today"
  const n = Math.abs(daysLeft)
  const unit = n === 1 ? "day" : "days"
  return daysLeft > 0 ? `${n} ${unit} left` : `${n} ${unit} late`
}

/** "No update for 9 days", or null when the Project has not gone quiet. */
export function quietText(quietDays: number | null): string | null {
  return quietDays === null ? null : `No update for ${quietDays} days`
}

/** A date as day/month/year, read as written. A finish date is a calendar day, not an instant. */
export function dayText(value: string | null): string {
  if (!value) return "Not set"
  const [year, month, day] = value.slice(0, 10).split("-")
  return `${day}/${month}/${year}`
}

/**
 * The finish date shown under "7 days left", or null when there is none. With
 * no date the line above already says "No finish date", so a second "Not set"
 * under it would only repeat it.
 */
export function finishDateLine(dueOn: string | null): string | null {
  return dueOn ? dayText(dueOn) : null
}

/**
 * A count with its noun in step: "1 task", "0 tasks", "2 tasks". Easy English
 * reads "1 tasks" as a mistake. Pass the plural when it is not just an s.
 */
export function countText(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** The earliest open milestone with a date, then open ones with no date in their order. Null when none is open. */
export function nextMilestone<T extends { doneAt: string | null; dueOn: string | null; order: number }>(list: T[]): T | null {
  const open = list.filter((m) => m.doneAt === null)
  if (open.length === 0) return null
  return [...open].sort((a, b) => {
    if (a.dueOn && b.dueOn) return a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.order - b.order
    if (a.dueOn) return -1
    if (b.dueOn) return 1
    return a.order - b.order
  })[0]
}

/** How many of the products (or modules) are ticked done. A line with no `done` at all is not ticked. */
export function linesDone(lines: Array<{ done: unknown }>): { done: number; total: number } {
  return { done: lines.filter((l) => l.done != null).length, total: lines.length }
}

/** The Progress cell. Null, never 0, when no task counts: "0%" would be a number about nothing. */
export function progressText(progressPercent: number | null): string {
  return progressPercent === null ? "No tasks yet" : `${progressPercent}%`
}

/** The most rows the server ever sends for a Projects list. */
export const PROJECTS_ROW_CAP = 200

/**
 * What the count tiles are counting. Once the list is at the server's 200-row
 * cap the tiles say so, rather than presenting a count as the whole picture.
 */
export function overviewScope(loaded: number): string {
  return loaded >= PROJECTS_ROW_CAP ? "In the first 200 loaded" : "On this list"
}

/**
 * The empty table's own words. A filter that matched nothing says so and
 * offers a way out; an empty workspace does not, because there is nothing to
 * clear.
 */
export function listEmptyState(isFiltered: boolean): { title: string; body: string; action: string | null } {
  return isFiltered
    ? { title: "No Projects match these filters", body: "Try a different filter, or All.", action: "Clear the filter" }
    : { title: "No Projects yet", body: "A Project starts from a Won Opportunity, on its Project tab.", action: null }
}

/**
 * The Health filter, worked out on the rows already loaded, because health is
 * worked out per Project from its tasks and is not a column the server can
 * filter on. A Project with no health (finished, cancelled, not started) never
 * matches: it is not "On track", it is unsaid.
 */
export function filterByHealth<T extends { health: string | null }>(list: T[], health: string): T[] {
  return health ? list.filter((p) => p.health === health) : list
}

/**
 * The five count tiles on the Projects page. Counted from the rows on the
 * page, so a tile always agrees with the table. "Due this week" is 0 to 7 days
 * left, so it never counts a finished Project (its days left is null) or a
 * late one.
 */
export function overviewStats(list: Array<{ status: string; health: string | null; daysLeft: number | null }>) {
  return {
    total: list.length,
    active: list.filter((p) => p.status === "IN_PROGRESS").length,
    late: list.filter((p) => p.health === "LATE").length,
    atRisk: list.filter((p) => p.health === "AT_RISK").length,
    blocked: list.filter((p) => p.status === "BLOCKED").length,
    dueThisWeek: list.filter((p) => p.daysLeft !== null && p.daysLeft >= 0 && p.daysLeft <= 7).length,
  }
}
