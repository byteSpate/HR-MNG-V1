import type { InboxTab } from "@/lib/api/types"

/**
 * The red number. `null` means show nothing: for zero, and also while the
 * count is loading or failed, because a `0` there would read as "you have
 * been told everything" when nobody knows that yet.
 */
export function badgeText(unread: number | undefined): string | null {
  if (!unread || unread <= 0) return null
  return unread > 99 ? "99+" : String(unread)
}

export function bellLabel(unread: number | undefined): string {
  return unread && unread > 0 ? `Notifications, ${unread} not read` : "Notifications"
}

export function emptyText(tab: InboxTab, unreadOnly: boolean): string {
  if (unreadOnly) return "You have read everything here."
  if (tab === "important") return "Nothing is waiting for you."
  if (tab === "primary") return "No news about your things yet."
  return "Nothing has happened yet."
}

/** `href` is stored role-agnostic ("/leave"); the reader's own group goes in front. */
export function itemHref(home: string, href: string | null): string | null {
  return href ? `${home}${href}` : null
}

/** "just now", "12m", "3h", "5d", then a short date. Read at a glance. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}
