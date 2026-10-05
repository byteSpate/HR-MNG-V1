import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import { isSalesAdmin } from "./sales.access"

/**
 * Permission switches: one Sales Hub action that a Sales Admin turns on or off
 * for all Sales Users at once (CONTEXT.md, Permission switch).
 *
 * This file is the only list of switches. The database stores values only, and
 * only for switches an admin has changed. Labels, groups and defaults stay
 * here, so a new switch needs no seed and a missing row cannot break anything.
 *
 * A Sales Admin and the Super Admin always keep every action. A switch that is
 * off means off for every Sales User, even the Owner of the record.
 */

export interface PermissionDef {
  /** Stable. Never renamed once shipped: stored rows and the audit log use it. */
  key: string
  /** What the screen says. Easy English. */
  label: string
  group: string
  /** What the switch means when no row exists. Today's behaviour for Phase 1. */
  default: boolean
  /** A Phase 2 switch is listed here but cannot be saved until Phase 2 ships. */
  phase: 1 | 2
}

export const SALES_PERMISSIONS = [
  { key: "account.create", label: "Create a Sales Account for themselves", group: "Sales Accounts", default: false, phase: 1 },
  { key: "account.edit", label: "Edit a Sales Account", group: "Sales Accounts", default: true, phase: 1 },
  { key: "opportunity.create", label: "Create an Opportunity", group: "Opportunities", default: true, phase: 1 },
  { key: "opportunity.change_stage", label: "Change the Stage of an Opportunity", group: "Opportunities", default: true, phase: 1 },
  { key: "opportunity.change_status", label: "Mark an Opportunity Won, Lost or Canceled", group: "Opportunities", default: true, phase: 1 },
  { key: "opportunity.hand_over", label: "Hand an Opportunity over to the Software team", group: "Opportunities", default: true, phase: 1 },
  { key: "opportunity.edit_products", label: "Add, change or remove Line Items", group: "Opportunities", default: true, phase: 1 },
  { key: "opportunity.remove_document", label: "Remove Document links", group: "Opportunities", default: true, phase: 1 },
  { key: "project.start", label: "Start a Project", group: "Projects", default: true, phase: 1 },
  { key: "project.edit", label: "Change a Project, its team and its Milestones", group: "Projects", default: true, phase: 1 },
  { key: "meeting.create", label: "Create a Meeting", group: "Meetings and Minutes", default: true, phase: 1 },
  { key: "minutes.send", label: "Send Meeting Minutes by email", group: "Meetings and Minutes", default: true, phase: 1 },
  { key: "minutes.edit_template", label: "Change the Minutes template", group: "Meetings and Minutes", default: true, phase: 1 },
  { key: "task.create", label: "Create a Task", group: "Tasks and Weekly Report", default: true, phase: 1 },
  { key: "weekly.submit", label: "Submit the Weekly Report", group: "Tasks and Weekly Report", default: true, phase: 1 },
  { key: "funnel.edit_cell", label: "Edit the Funnel", group: "Funnel", default: true, phase: 1 },
  // The four admin-only powers a Sales Admin may hand to Sales Users. Off by
  // default, as they are today. Enforced by `canDo` in the services and by
  // `requireSalesPermission` on the routes.
  { key: "target.set", label: "Set yearly Targets for other people (also turn on the team Dashboard)", group: "Team and Targets", default: false, phase: 1 },
  { key: "team.dashboard", label: "See the team Dashboard", group: "Team and Targets", default: false, phase: 1 },
  { key: "team.funnel", label: "See the team Funnel", group: "Team and Targets", default: false, phase: 1 },
  { key: "team.weekly", label: "See every Weekly Report", group: "Team and Targets", default: false, phase: 1 },
] as const satisfies readonly PermissionDef[]

export type PermissionKey = (typeof SALES_PERMISSIONS)[number]["key"]
export type PermissionMap = Record<PermissionKey, boolean>

/** Said once, so every refusal reads the same. */
export const PERMISSION_OFF_MESSAGE =
  "A Sales Admin has turned this off for Sales Users. Ask a Sales Admin to turn it on."

const BY_KEY = new Map<string, PermissionDef>(SALES_PERMISSIONS.map((p) => [p.key, p]))

const TTL_MS = 30_000
let cached: { at: number; map: PermissionMap } | null = null

/** A save clears this server's copy. Other servers catch up within 30 seconds. */
export function clearPermissionCache(): void {
  cached = null
}

function defaultMap(): PermissionMap {
  return Object.fromEntries(SALES_PERMISSIONS.map((p) => [p.key, p.default])) as PermissionMap
}

/**
 * Every switch's current value: the catalog default, overlaid with any stored
 * row. Held for 30 seconds in this process, so a gated request costs no query
 * most of the time. A failed read is not cached and is not swallowed: a
 * permission check that cannot be answered is a 500, not a yes.
 */
export async function getPermissionMap(client: typeof prisma = prisma): Promise<PermissionMap> {
  const now = Date.now()
  if (cached && now - cached.at < TTL_MS) return cached.map

  const rows = await client.salesPermission.findMany({ select: { key: true, enabled: true } })
  const map = defaultMap()
  for (const row of rows) {
    if (BY_KEY.has(row.key)) map[row.key as PermissionKey] = row.enabled
  }
  cached = { at: now, map }
  return map
}

/** May this person do this action right now? */
export async function canDo(actor: AccessTokenPayload, key: PermissionKey): Promise<boolean> {
  if (isSalesAdmin(actor)) return true
  if (!actor.salesRole) return false
  return (await getPermissionMap())[key]
}

/** The caller's own answers, for the client to hide buttons. Looks only: the server is the gate. */
export async function myPermissions(actor: AccessTokenPayload): Promise<PermissionMap> {
  const all = defaultMap()
  if (isSalesAdmin(actor)) {
    return Object.fromEntries(Object.keys(all).map((k) => [k, true])) as PermissionMap
  }
  if (!actor.salesRole) {
    return Object.fromEntries(Object.keys(all).map((k) => [k, false])) as PermissionMap
  }
  return { ...(await getPermissionMap()) }
}

export interface PermissionRow {
  key: PermissionKey
  label: string
  group: string
  phase: 1 | 2
  default: boolean
  enabled: boolean
  changedAt: string | null
  changedByName: string | null
}

/** The screen's list. Always reads the table, never the cache: an admin must see what is stored. */
export async function listPermissions(client: typeof prisma = prisma): Promise<PermissionRow[]> {
  const stored = await client.salesPermission.findMany({
    select: { key: true, enabled: true, updatedBy: true, updatedAt: true },
  })
  const byKey = new Map(stored.map((row) => [row.key, row]))

  const userIds = [...new Set(stored.map((row) => row.updatedBy).filter((id): id is string => !!id))]
  const users = userIds.length
    ? await client.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, displayName: true, email: true, employee: { select: { fullName: true } } },
      })
    : []
  const nameOf = new Map(users.map((u) => [u.id, u.employee?.fullName ?? u.displayName ?? u.email]))

  return SALES_PERMISSIONS.map((def) => {
    const row = byKey.get(def.key)
    return {
      key: def.key,
      label: def.label,
      group: def.group,
      phase: def.phase,
      default: def.default,
      enabled: row ? row.enabled : def.default,
      changedAt: row ? row.updatedAt.toISOString() : null,
      changedByName: row?.updatedBy ? (nameOf.get(row.updatedBy) ?? null) : null,
    }
  })
}

/**
 * Saves a batch of switch changes in one transaction.
 *
 * Every key is checked before anything is written, so one bad key refuses the
 * whole save. A value that already matches is skipped and writes no row and no
 * audit entry, like `setSalesRole`. The audit row records who, which switch,
 * and before and after.
 */
export async function savePermissions(
  changes: { key: string; enabled: boolean }[],
  actor: AccessTokenPayload
): Promise<PermissionRow[]> {
  // The last value for a key wins.
  const wanted = new Map<string, boolean>()
  for (const change of changes) wanted.set(change.key, change.enabled)

  for (const key of wanted.keys()) {
    const def = BY_KEY.get(key)
    if (!def) {
      throw new AppError(400, `"${key}" is not a Sales Hub permission switch. Reload the page and try again.`)
    }
    if (def.phase !== 1) {
      throw new AppError(400, `"${def.label}" cannot be changed yet. It is not available.`)
    }
  }

  await prisma.$transaction(async (tx) => {
    const stored = await tx.salesPermission.findMany({
      where: { key: { in: [...wanted.keys()] } },
      select: { key: true, enabled: true },
    })
    const storedBy = new Map(stored.map((row) => [row.key, row.enabled]))

    for (const [key, enabled] of wanted) {
      const def = BY_KEY.get(key)!
      const before = storedBy.has(key) ? storedBy.get(key)! : def.default
      if (before === enabled) continue

      await tx.salesPermission.upsert({
        where: { key },
        create: { key, enabled, updatedBy: actor.sub },
        update: { enabled, updatedBy: actor.sub },
      })
      await writeAudit(tx, {
        entity: "SALES_PERMISSION",
        entityId: key,
        action: "UPDATE",
        changedBy: actor.sub,
        before: { enabled: before },
        after: { enabled },
        note: def.label,
      })
    }
  })

  clearPermissionCache()
  return listPermissions()
}
