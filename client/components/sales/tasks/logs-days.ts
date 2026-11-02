import type { SalesTaskSummary } from "@/lib/api/types"

/**
 * The days of one week on the Logs tab (owner, 2026-11-02). The team works
 * Sunday to Thursday. Friday and the optional Saturday before the week show
 * only when a task is on them, so nothing is hidden and nothing empty is shown.
 *
 * The week follows the team's own convention, the same as the server's
 * `weekStartOf`: a Friday stays with the week that just ended, and a Saturday
 * opens the week that follows it.
 */

const DAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const WORKING_DAYS = 5

/** Dates are YYYY-MM-DD, worked out in UTC so the browser's time zone cannot move a day. */
function parse(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
  const moved = parse(date)
  moved.setUTCDate(moved.getUTCDate() + days)
  return format(moved)
}

/** The Sunday of the week a date belongs to. */
export function weekStartOf(date: string): string {
  const weekday = parse(date).getUTCDay()
  if (weekday === 6) return addDays(date, 1)
  return addDays(date, -weekday)
}

/** Whole weeks forward (or back, when negative) from a Sunday. */
export function shiftWeek(weekStart: string, weeks: number): string {
  return addDays(weekStart, weeks * 7)
}

/** The first and last day to ask the server for: the Saturday before, to the Friday. */
export function weekRange(weekStart: string): { from: string; to: string } {
  return { from: addDays(weekStart, -1), to: addDays(weekStart, 5) }
}

export interface LogDaySlot {
  date: string
  label: string
  tasks: SalesTaskSummary[]
}

/** A task counts for the day it was done, and any other for the day it is due. */
const dayOf = (task: SalesTaskSummary) => (task.status === "DONE" && task.doneOn ? task.doneOn : task.dueOn)

export function logDaySlots(weekStart: string, tasks: SalesTaskSummary[]): LogDaySlot[] {
  const byDay = new Map<string, SalesTaskSummary[]>()
  for (const task of tasks) byDay.set(dayOf(task), [...(byDay.get(dayOf(task)) ?? []), task])

  const saturday = addDays(weekStart, -1)
  const friday = addDays(weekStart, 5)
  const dates = [
    ...(byDay.has(saturday) ? [saturday] : []),
    ...Array.from({ length: WORKING_DAYS }, (_, i) => addDays(weekStart, i)),
    ...(byDay.has(friday) ? [friday] : []),
  ]
  return dates.map((date) => ({ date, label: DAY_NAME[parse(date).getUTCDay()], tasks: byDay.get(date) ?? [] }))
}

/** "6 Sep to 10 Sep 2026", for the week picker. */
export function weekLabel(weekStart: string): string {
  const first = parse(weekStart)
  const last = parse(addDays(weekStart, WORKING_DAYS - 1))
  const part = (d: Date, withYear: boolean) =>
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" })
  return `${part(first, false)} to ${part(last, true)}`
}
