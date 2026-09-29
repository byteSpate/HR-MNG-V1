import prisma from "../../../config/prisma"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { loadProjectRow } from "./project.access"

/** How a Project status reads in a sentence. Same words the Status tab uses. */
const STATUS_WORDS: Record<string, string> = {
  NOT_STARTED: "Not started", IN_PROGRESS: "In progress", BLOCKED: "Blocked",
  ON_HOLD: "On hold", COMPLETED: "Completed", CANCELLED: "Cancelled",
}

/**
 * A short, newest-first list of what happened on a Project (spec §1.7; left
 * out of Phase 1). Read from its audit rows rather than a second table: the
 * audit log already records every Project write, so a table here would be the
 * same facts written twice and able to disagree.
 */
export async function listProjectActivity(projectId: string, actor: AccessTokenPayload) {
  await loadProjectRow(prisma, projectId, actor)
  const rows = await prisma.auditLog.findMany({
    where: { entity: "PROJECT", entityId: projectId },
    orderBy: { changedAt: "desc" },
    take: 50,
  })
  const ids = [...new Set(rows.map((r) => r.changedBy).filter((v): v is string => !!v))]
  const users = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, displayName: true, email: true, employee: { select: { fullName: true } } },
      })
    : []
  const names = new Map(users.map((u) => [u.id, u.employee?.fullName ?? u.displayName ?? u.email]))
  return rows.map((r) => {
    const before = (r.before ?? {}) as Record<string, unknown>
    const after = (r.after ?? {}) as Record<string, unknown>
    let text = r.note ?? "Project changed"
    if (r.action === "CREATE") text = "Project started"
    else if (after.status && before.status) {
      text = `Status: ${STATUS_WORDS[String(before.status)]} to ${STATUS_WORDS[String(after.status)]}`
    } else if (after.milestone || before.milestone) {
      // Phase 1's updateMilestone writes `after: { ...body }`, which carries no
      // milestone key, so the title comes from the before side.
      text = `${r.note ?? "Milestone changed"}: ${String(after.milestone ?? before.milestone)}`
    }
    return {
      id: r.id,
      at: r.changedAt.toISOString(),
      byName: r.changedBy ? (names.get(r.changedBy) ?? null) : null,
      text,
    }
  })
}
