"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { RiNotification3Line } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useSession } from "@/lib/auth/session-context"
import { listEvents } from "@/lib/api/events"
import { ROLE_ROUTES } from "@/lib/auth/role-routes"
import type { EventItem, EventSeverity } from "@/lib/api/types"

/** Enough to be worth opening, few enough that the panel does not scroll far. */
const FEED_LIMIT = 8

/**
 * Only the two severities that ask something of the reader are marked.
 *
 * Giving all four a coloured dot makes the colour meaningless, since every row
 * carries one. INFO and SUCCESS are the record of something that already went
 * fine and need no flag.
 */
const SEVERITY_DOT: Partial<Record<EventSeverity, string>> = {
  WARNING: "bg-warning",
  ERROR: "bg-danger",
}

/**
 * "just now", "12m", "3h", "5d" — the feed is read at a glance, and an
 * absolute timestamp on every row is more text than the row itself.
 */
function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function FeedRow({ event, home }: { event: EventItem; home: string }) {
  const dot = SEVERITY_DOT[event.severity]
  const body = (
    <>
      <div className="flex items-start gap-2">
        {dot ? <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${dot}`} aria-hidden /> : null}
        <div className="min-w-0 flex-1">
          <div className="text-body-sm font-semibold text-ink-body">{event.title}</div>
          {event.meta ? <div className="text-caption text-ink-muted">{event.meta}</div> : null}
        </div>
        <span className="shrink-0 text-caption whitespace-nowrap text-ink-muted">
          {timeAgo(event.createdAt)}
        </span>
      </div>
    </>
  )

  // `href` is stored role-agnostic ("/leave"), so the reader's own route group
  // is prefixed here. An event with no href is a statement of fact with
  // nowhere to go, and must not become a dead link.
  return event.href ? (
    <li className="border-b border-surface-sunken last:border-b-0">
      <Link href={`${home}${event.href}`} className="block px-3.5 py-2.5 transition-colors hover:bg-surface-hover">
        {body}
      </Link>
    </li>
  ) : (
    <li className="border-b border-surface-sunken px-3.5 py-2.5 last:border-b-0">{body}</li>
  )
}

/**
 * Recent activity the signed-in user is entitled to see.
 *
 * This used to read whatever leave requests happened to be sitting in the
 * React Query cache, which meant it was empty until you visited the leave
 * page, covered leave and nothing else, and said so in its own footer.
 * `/api/events` is the real feed: scoped server-side by four audience rules,
 * covering every module that emits, and it had no caller anywhere.
 *
 * Still no unread badge. The events are real, but nothing is delivered
 * anywhere — no SMTP is configured — and a count on a bell is read as "you
 * have been told", which for HR is the difference between an employee who
 * knows and one who does not.
 */
export function NotificationBell() {
  const { accessToken, user, status } = useSession()
  const isAuthed = status === "authenticated" && !!accessToken

  const feed = useQuery({
    queryKey: ["events", FEED_LIMIT],
    queryFn: () => listEvents(accessToken!, { limit: FEED_LIMIT }),
    enabled: isAuthed,
    // The feed is a convenience, not a live console. Refetching on focus
    // keeps it current without polling every open tab.
    refetchOnWindowFocus: true,
  })

  const home = user ? ROLE_ROUTES[user.role] : ""
  const items = feed.data?.items ?? []

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Recent activity"
            className="relative size-8.5 rounded border-line text-ink-muted hover:bg-surface-hover"
          />
        }
      >
        <RiNotification3Line className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 min-w-80 p-0">
        <div className="border-b border-surface-sunken px-3.5 py-2.5 text-body-sm font-bold">
          Recent activity
        </div>

        {feed.isPending ? (
          <ul>
            {[0, 1, 2].map((i) => (
              <li key={i} className="border-b border-surface-sunken px-3.5 py-2.5 last:border-b-0">
                <div className="h-3 w-40 animate-pulse rounded bg-surface-sunken" />
                <div className="mt-1.5 h-2.5 w-24 animate-pulse rounded bg-surface-hover" />
              </li>
            ))}
          </ul>
        ) : feed.isError ? (
          <div className="px-3.5 py-4 text-caption text-ink-muted">
            Activity could not be loaded.{" "}
            <Button
              variant="link"
              onClick={() => feed.refetch()}
              className="h-auto p-0 text-caption font-bold text-ink-body underline"
            >
              Retry
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="px-3.5 py-4 text-caption text-ink-muted">
            Nothing has happened yet that concerns you.
          </div>
        ) : (
          <ul>
            {items.map((event) => (
              <FeedRow key={event.id} event={event} home={home} />
            ))}
          </ul>
        )}

        <div className="border-t border-surface-sunken bg-surface-hover px-3.5 py-2.5 text-caption text-ink-muted">
          A record of what happened here. Nothing on this list was emailed.
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
