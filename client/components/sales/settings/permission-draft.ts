import type { SalesPermissionKey, SalesPermissionRow } from "@/lib/api/types"

export type PermissionDraft = Partial<Record<SalesPermissionKey, boolean>>

/**
 * The rows the screen shows, grouped in the order the groups first appear.
 * A Phase 2 row is left out: a switch the server will not save is a control
 * that cannot do anything.
 */
export function groupPermissions(rows: SalesPermissionRow[]): Array<{ group: string; rows: SalesPermissionRow[] }> {
  const groups: Array<{ group: string; rows: SalesPermissionRow[] }> = []
  for (const row of rows) {
    if (row.phase !== 1) continue
    const existing = groups.find((g) => g.group === row.group)
    if (existing) existing.rows.push(row)
    else groups.push({ group: row.group, rows: [row] })
  }
  return groups
}

/** What a save would send: only the switches whose draft differs from the saved value. */
export function pendingChanges(
  rows: SalesPermissionRow[],
  draft: PermissionDraft
): Array<{ key: SalesPermissionKey; enabled: boolean }> {
  return rows
    .filter((row) => draft[row.key] !== undefined && draft[row.key] !== row.enabled)
    .map((row) => ({ key: row.key, enabled: draft[row.key]! }))
}

/** The newest change among a group's rows, or null if none was ever changed. */
export function lastChangeOf(rows: SalesPermissionRow[]): { changedAt: string; changedByName: string | null } | null {
  let best: { changedAt: string; changedByName: string | null } | null = null
  for (const row of rows) {
    if (!row.changedAt) continue
    if (!best || row.changedAt > best.changedAt) best = { changedAt: row.changedAt, changedByName: row.changedByName }
  }
  return best
}
