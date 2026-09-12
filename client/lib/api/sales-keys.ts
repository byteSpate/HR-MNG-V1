/**
 * TanStack Query keys for the Sales Hub.
 *
 * Phase 1 wrote these inline at each call site. This collects them without
 * changing a single one: every function below returns **exactly** the array
 * that page already builds, so a component still using an inline key and a
 * component using this factory invalidate each other correctly. That
 * compatibility is the point — a factory producing a slightly different shape
 * would silently stop invalidation working across the boundary, and the stale
 * panel would be the one nobody was looking at.
 *
 * The prefixes nest deliberately: `salesKeys.account(id)` is a prefix of
 * `salesKeys.accountContacts(id)`, so invalidating the account invalidates
 * everything hanging off it, and there is no list of children to keep in step.
 */

export const salesKeys = {
  all: ["sales"] as const,

  // ── accounts ────────────────────────────────────────────────────────────
  /** The list. `scope` is "mine" or "all", matching the page that reads it. */
  accounts: (scope: string) => ["sales", "accounts", scope] as const,
  account: (id: string) => ["sales", "accounts", id] as const,
  accountContacts: (id: string) => ["sales", "accounts", id, "contacts"] as const,
  accountTimeline: (id: string) => ["sales", "accounts", id, "timeline"] as const,
  accountHistory: (id: string) => ["sales", "accounts", id, "history"] as const,

  // ── opportunities ───────────────────────────────────────────────────────
  /**
   * Filters are part of the key, so two filter settings are two cache entries
   * rather than one that flickers between answers.
   */
  opportunities: (filters: Record<string, unknown> = {}) =>
    ["sales", "opportunities", filters] as const,
  opportunity: (id: string) => ["sales", "opportunities", id] as const,
  opportunityTimeline: (id: string) => ["sales", "opportunities", id, "timeline"] as const,
  opportunityHistory: (id: string) => ["sales", "opportunities", id, "history"] as const,

  // ── comments ────────────────────────────────────────────────────────────
  comments: (entity: string, entityId: string) => ["sales", "comments", entity, entityId] as const,

  // ── targets and the dashboard ───────────────────────────────────────────
  targets: (calendarYear: number, employeeId?: string) =>
    ["sales", "targets", calendarYear, employeeId ?? "me"] as const,
  dashboard: (employeeId?: string) => ["sales", "dashboard", employeeId ?? "me"] as const,
} as const

/**
 * Everything a write to one opportunity can make stale.
 *
 * Collected here rather than spelled out at each mutation, because the list
 * grew every time a panel was added and the one that got forgotten was always
 * the dashboard — the page furthest from the edit and the least likely to be
 * noticed going stale.
 */
export function opportunityWriteKeys(id: string) {
  return [
    salesKeys.opportunity(id),
    salesKeys.opportunities(),
    salesKeys.opportunityTimeline(id),
    salesKeys.opportunityHistory(id),
    ["sales", "dashboard"] as const,
  ]
}
