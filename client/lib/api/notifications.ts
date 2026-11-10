import { apiFetch } from "./client"
import type { InboxPage, InboxTab } from "./types"

export interface InboxQuery {
  tab: InboxTab
  unread?: boolean
  /** All tab only: leave company activity out. The bell uses this. */
  mine?: boolean
  cursor?: string
  limit?: number
}

/** Every key starts with this, so one invalidate refreshes the badge, the bell and the page. */
export const notificationKeys = {
  all: ["notifications"] as const,
  count: ["notifications", "count"] as const,
  list: (q: InboxQuery) => ["notifications", "list", q.tab, !!q.unread, !!q.mine, q.limit ?? null] as const,
}

/** Unread items about you or waiting for you. Company activity never counts. */
export function getUnreadCount(accessToken: string): Promise<{ unread: number }> {
  return apiFetch<{ unread: number }>("/api/notifications/count", { accessToken })
}

export function listNotifications(accessToken: string, q: InboxQuery): Promise<InboxPage> {
  const params = new URLSearchParams({ tab: q.tab })
  if (q.unread) params.set("unread", "true")
  if (q.mine) params.set("mine", "true")
  if (q.cursor) params.set("cursor", q.cursor)
  if (q.limit !== undefined) params.set("limit", String(q.limit))
  return apiFetch<InboxPage>(`/api/notifications?${params.toString()}`, { accessToken })
}

export function markNotificationRead(accessToken: string, id: string): Promise<void> {
  return apiFetch<void>(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH", accessToken })
}

export function markAllNotificationsRead(accessToken: string): Promise<{ marked: number }> {
  return apiFetch<{ marked: number }>("/api/notifications/read-all", { method: "POST", accessToken })
}
