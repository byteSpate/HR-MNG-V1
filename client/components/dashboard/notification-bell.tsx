"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiNotification3Line } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { badgeText, bellLabel } from "@/components/notifications/inbox-format"
import { InboxRow } from "@/components/notifications/inbox-row"
import { useSession } from "@/lib/auth/session-context"
import { ROLE_ROUTES } from "@/lib/auth/role-routes"
import {
  getUnreadCount,
  listNotifications,
  markNotificationRead,
  notificationKeys,
  type InboxQuery,
} from "@/lib/api/notifications"
import type { InboxItem } from "@/lib/api/types"

/** The bell shows your newest 10. Everything else is on the Notifications page. */
const BELL_QUERY: InboxQuery = { tab: "all", mine: true, limit: 10 }

/**
 * The red number and your newest notifications.
 *
 * The number counts only what is about you or waiting for you. Company
 * activity is on the Notifications page, under All, and never counts here.
 *
 * Checked once a minute while the tab is open, and again when you come back
 * to the tab. Not while the tab is hidden: nobody is looking at it.
 */
export function NotificationBell() {
  const { accessToken, user, status } = useSession()
  const isAuthed = status === "authenticated" && !!accessToken
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

  const count = useQuery({
    queryKey: notificationKeys.count,
    queryFn: () => getUnreadCount(accessToken!),
    enabled: isAuthed,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })

  const feed = useQuery({
    queryKey: notificationKeys.list(BELL_QUERY),
    queryFn: () => listNotifications(accessToken!, BELL_QUERY),
    enabled: isAuthed && open,
  })

  const markRead = useMutation({
    mutationFn: (id: string) => markNotificationRead(accessToken!, id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  })

  const onOpenItem = (item: InboxItem) => {
    setOpen(false)
    if (item.unread) markRead.mutate(item.id)
  }

  const home = user ? ROLE_ROUTES[user.role] : ""
  // Only a successful count can show a number. Loading or failed shows none.
  const unread = count.isSuccess ? count.data.unread : undefined
  const badge = badgeText(unread)
  const items = feed.data?.items ?? []

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={bellLabel(unread)}
            className="relative size-8.5 rounded border-line text-ink-muted hover:bg-surface-hover"
          />
        }
      >
        <RiNotification3Line className="size-4" />
        {badge ? (
          <span
            aria-hidden
            className="absolute -top-1.5 -right-1.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-danger px-1 text-caption leading-none font-bold text-surface tabular-nums"
          >
            {badge}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 min-w-80 p-0">
        <div className="border-b border-surface-sunken px-3.5 py-2.5 text-body-sm font-bold">Notifications</div>

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
            Notifications could not be loaded.{" "}
            <Button
              variant="link"
              onClick={() => feed.refetch()}
              className="h-auto p-0 text-caption font-bold text-ink-body underline"
            >
              Try again
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="px-3.5 py-4 text-caption text-ink-muted">You have no notifications yet.</div>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {items.map((item) => (
              <InboxRow key={item.id} item={item} home={home} onOpen={onOpenItem} />
            ))}
          </ul>
        )}

        <div className="border-t border-surface-sunken bg-surface-hover px-3.5 py-2.5 text-caption">
          <Link
            href={`${home}/notifications`}
            onClick={() => setOpen(false)}
            className="font-bold text-ink-body underline"
          >
            See all
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
