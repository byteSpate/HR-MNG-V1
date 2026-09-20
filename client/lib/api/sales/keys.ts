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
  /**
   * Under its own prefix rather than the account's: it moves when a deal on
   * the account is won or its value or margin changes, so every deal write
   * refreshes it through `opportunityWriteKeys`.
   */
  accountMargin: (id: string) => ["sales", "account-margin", id] as const,

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
  /** Product, brand and model values already used on deals the viewer can see. */
  lineSuggestions: (field: string, q: string) => ["sales", "suggestions", field, q] as const,

  // ── comments ────────────────────────────────────────────────────────────
  comments: (entity: string, entityId: string) => ["sales", "comments", entity, entityId] as const,

  // ── targets and the dashboard ───────────────────────────────────────────
  targets: (calendarYear: number, employeeId?: string) =>
    ["sales", "targets", calendarYear, employeeId ?? "me"] as const,
  dashboard: (employeeId?: string) => ["sales", "dashboard", employeeId ?? "me"] as const,

  // ── meetings and tasks ──────────────────────────────────────────────────
  meetings: (filters: Record<string, unknown> = {}) => ["sales", "meetings", filters] as const,
  tasks: (filters: Record<string, unknown> = {}) => ["sales", "tasks", filters] as const,
  /** Who may attend a meeting on our side. Outside "meetings", so a meeting write does not refetch it. */
  meetingAttendees: () => ["sales", "meeting-attendees"] as const,

  // ── meeting minutes (phase 4) ───────────────────────────────────────────
  minutesList: (filters: Record<string, unknown> = {}) => ["sales", "minutes", "list", filters] as const,
  minutesWaiting: (mine: boolean) => ["sales", "minutes", "waiting", mine] as const,
  /**
   * One document. Under "doc" and not beside "list" and "waiting", so a write
   * refreshes the lists without refetching the document under its writer:
   * the editor takes what the server sends back instead.
   */
  minutes: (id: string) => ["sales", "minutes", "doc", id] as const,
  // ── the weekly report (phase 5) ─────────────────────────────────────────
  /** My week. Keyed by the week, so moving between weeks keeps each cached. */
  weeklyMine: (week: string | null) => ["sales", "weekly", "mine", week] as const,
  /** All Reports, for an admin, one chosen week. */
  weeklyTeam: (week: string | null) => ["sales", "weekly", "team", week] as const,
  /** One person's week, read by an admin. */
  weeklyOf: (employeeId: string, week: string | null) => ["sales", "weekly", "of", employeeId, week] as const,

  /** Sales Settings. Outside "minutes", so writing a document does not refetch it. */
  minutesTemplate: () => ["sales", "settings", "minutes-template"] as const,
} as const

/**
 * Everything a meeting or task write can make stale: both lists, the overview
 * and its nav badges, and the Timelines of the account and the deal it sits
 * on. The account and deal prefixes are wide on purpose; the write does not
 * always know which account's Timeline it touched.
 */
export function planWriteKeys() {
  return [
    ["sales", "meetings"] as const,
    ["sales", "tasks"] as const,
    ["sales", "dashboard"] as const,
    ["sales", "accounts"] as const,
    ["sales", "opportunities"] as const,
    // Completing a meeting puts it on "Waiting for minutes"; starting, saving
    // or sending minutes moves them on the list. Never the open document.
    ["sales", "minutes", "waiting"] as const,
    ["sales", "minutes", "list"] as const,
    // A scheduled meeting and a completed task are both source facts for a
    // Weekly Report, so a write made from that page must refresh its week too.
    ["sales", "weekly"] as const,
  ]
}

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
    // Every account's margin, because this write does not know the account.
    // One small read per open account page is cheaper than a stale total.
    ["sales", "account-margin"] as const,
  ]
}
