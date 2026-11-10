/**
 * Reading and marking the caller's notifications.
 *
 * Every read is scoped to the token's user. There is no id-of-someone-else
 * parameter anywhere: the person is always `actor.sub`.
 *
 * The All tab adds company activity: events the caller may see under the
 * existing `visibleToFilter` rules, minus any event that already made a row
 * for them (that one is shown once, as theirs, with its read state).
 */

import prisma from "../../config/prisma"
import type { Prisma } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import type { AccessTokenPayload } from "../auth/auth.types"
import { notYetPublished, scopeForActor, visibleToFilter } from "../event/event.service"
import type { InboxItem, InboxPage, InboxTab } from "./inbox.types"

export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 50

export interface InboxQuery {
  tab: InboxTab
  unread?: boolean
  /** All tab only: leave company activity out. The bell uses this. */
  mine?: boolean
  cursor?: string
  limit?: number
}

interface Cursor {
  at: Date
  id: string
}

function parseCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null
  const [iso, id] = raw.split("|")
  const at = new Date(iso ?? "")
  if (!id || Number.isNaN(at.getTime())) {
    throw new AppError(400, "This page link is broken. Open the list again from the start.")
  }
  return { at, id }
}

/** Strictly after the cursor in (createdAt desc, id desc) order. */
function afterCursor(cursor: Cursor | null) {
  return cursor
    ? { OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] }
    : {}
}

const mineWhere = (userId: string, now: Date) => ({ userId, visibleFrom: { lte: now } })

export async function unreadCount(userId: string, now = new Date()): Promise<number> {
  return prisma.notification.count({ where: { ...mineWhere(userId, now), readAt: null, closedAt: null } })
}

interface MineRow {
  id: string
  tab: "IMPORTANT" | "PRIMARY"
  title: string
  meta: string | null
  href: string | null
  readAt: Date | null
  closedAt: Date | null
  createdAt: Date
}

interface ActivityRow {
  id: string
  title: string
  meta: string | null
  href: string | null
  createdAt: Date
}

type Keyed = { key: Cursor; item: InboxItem }

const fromMine = (r: MineRow): Keyed => ({
  key: { at: r.createdAt, id: r.id },
  item: {
    id: r.id,
    source: "MINE",
    tab: r.tab,
    title: r.title,
    meta: r.meta,
    href: r.href,
    unread: r.readAt === null && r.closedAt === null,
    closed: r.closedAt !== null,
    createdAt: r.createdAt.toISOString(),
  },
})

const fromActivity = (r: ActivityRow): Keyed => ({
  key: { at: r.createdAt, id: r.id },
  item: {
    id: `event:${r.id}`,
    source: "ACTIVITY",
    tab: null,
    title: r.title,
    meta: r.meta,
    href: r.href,
    unread: false,
    closed: false,
    createdAt: r.createdAt.toISOString(),
  },
})

/** Newer first; on a tie, the larger id first (the same order both queries use). */
function newerFirst(a: Keyed, b: Keyed): number {
  const dt = b.key.at.getTime() - a.key.at.getTime()
  if (dt !== 0) return dt
  return a.key.id < b.key.id ? 1 : a.key.id > b.key.id ? -1 : 0
}

export async function listInbox(actor: AccessTokenPayload, q: InboxQuery, now = new Date()): Promise<InboxPage> {
  const limit = Math.min(Math.max(Math.trunc(q.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const cursor = parseCursor(q.cursor)
  const order = [{ createdAt: "desc" as const }, { id: "desc" as const }]

  const where: Prisma.NotificationWhereInput = {
    ...mineWhere(actor.sub, now),
    ...(q.tab === "important" ? { tab: "IMPORTANT" } : q.tab === "primary" ? { tab: "PRIMARY" } : {}),
    ...(q.unread ? { readAt: null, closedAt: null } : {}),
    ...afterCursor(cursor),
  }

  const mineRows: MineRow[] = await prisma.notification.findMany({
    where,
    orderBy: order,
    take: limit + 1,
    select: { id: true, tab: true, title: true, meta: true, href: true, readAt: true, closedAt: true, createdAt: true },
  })

  let merged = mineRows.map(fromMine)

  // Company activity: All tab only, and never when only unread or only mine is asked.
  if (q.tab === "all" && !q.mine && !q.unread) {
    const scope = await scopeForActor(actor)
    const activity: ActivityRow[] = await prisma.event.findMany({
      where: {
        AND: [
          visibleToFilter(actor, scope),
          notYetPublished(now),
          { notifications: { none: { userId: actor.sub } } },
          afterCursor(cursor),
        ],
      },
      orderBy: order,
      take: limit + 1,
      select: { id: true, title: true, meta: true, href: true, createdAt: true },
    })
    merged = [...merged, ...activity.map(fromActivity)].sort(newerFirst)
  }

  const page = merged.slice(0, limit)
  const last = page[page.length - 1]
  return {
    items: page.map((k) => k.item),
    nextCursor: merged.length > limit && last ? `${last.key.at.toISOString()}|${last.key.id}` : null,
  }
}

export async function markRead(userId: string, id: string): Promise<void> {
  const row = await prisma.notification.findFirst({ where: { id, userId } })
  if (!row) throw new AppError(404, "This notification was not found. It may belong to someone else.")
  if (row.readAt) return
  await prisma.notification.update({ where: { id }, data: { readAt: new Date() } })
}

export async function markAllRead(userId: string, now = new Date()): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { ...mineWhere(userId, now), readAt: null },
    data: { readAt: now },
  })
  return result.count
}
