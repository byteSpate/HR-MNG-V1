import prisma from "../../../config/prisma"
import { SALES_PERMISSIONS } from "../sales.permissions"

export interface PermissionHistoryRow {
  key: string
  label: string
  /** What the switch was changed to. */
  enabled: boolean
  changedAt: string
  changedByName: string | null
}

const LABELS = new Map<string, string>(SALES_PERMISSIONS.map((p) => [p.key, p.label]))

/** The newest 50 switch changes, read from the audit log. */
export async function listPermissionHistory(client: typeof prisma = prisma): Promise<PermissionHistoryRow[]> {
  const rows = await client.auditLog.findMany({
    where: { entity: "SALES_PERMISSION" },
    orderBy: { changedAt: "desc" },
    take: 50,
    select: { entityId: true, changedBy: true, changedAt: true, after: true },
  })
  if (rows.length === 0) return []

  const ids = [...new Set(rows.map((r) => r.changedBy).filter((id): id is string => !!id))]
  const users = ids.length
    ? await client.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, displayName: true, email: true, employee: { select: { fullName: true } } },
      })
    : []
  const nameOf = new Map(users.map((u) => [u.id, u.employee?.fullName ?? u.displayName ?? u.email]))

  return rows.map((r) => ({
    key: r.entityId,
    label: LABELS.get(r.entityId) ?? r.entityId,
    enabled: (r.after as { enabled?: boolean } | null)?.enabled === true,
    changedAt: r.changedAt.toISOString(),
    changedByName: r.changedBy ? (nameOf.get(r.changedBy) ?? null) : null,
  }))
}
