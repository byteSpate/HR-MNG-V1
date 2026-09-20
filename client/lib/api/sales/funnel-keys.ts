/**
 * TanStack Query keys for the funnel (revision §27).
 *
 * The prefixes nest deliberately, as `salesKeys` does: `funnelKeys.all` is a
 * prefix of every key below, so invalidating it refreshes the grid, the team
 * list and the meeting at once, and there is no list of children to keep in
 * step.
 */

import type { FunnelQueryOptions } from "../types"

export const funnelKeys = {
  all: ["sales", "funnel"] as const,

  /**
   * The filters are part of the key, so two filter settings are two cache
   * entries rather than one that flickers between answers.
   */
  grid: (options: FunnelQueryOptions = {}) => ["sales", "funnel", "grid", options] as const,

  team: () => ["sales", "funnel", "team"] as const,

  /**
   * The week is part of the key: last week's meeting and this week's are
   * different things and must not share a cache entry.
   */
  meeting: (weekStart?: string) => ["sales", "funnel", "meeting", weekStart ?? "current"] as const,

  actions: (meetingId: string) => ["sales", "funnel", "meeting", meetingId, "actions"] as const,
}

/**
 * What a cell edit invalidates.
 *
 * The grid, because the row changed. The team list, because both totals move.
 * The sales dashboard, because its funnel row counts open quoted deals.
 *
 * Deliberately not the whole `salesKeys.all`: that would refetch accounts,
 * meetings and minutes for a one-cell change.
 */
export const funnelWriteKeys: readonly (readonly string[])[] = [
  funnelKeys.all,
  ["sales", "dashboard"],
]
