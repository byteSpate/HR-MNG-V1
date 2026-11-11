"use client"

import { Suspense, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { PageHeader } from "@/components/dashboard/page-header"
import { CheckboxField, PanelAlert, PanelNotice, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useSession } from "@/lib/auth/session-context"
import { ROLE_ROUTES } from "@/lib/auth/role-routes"
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationKeys,
} from "@/lib/api/notifications"
import type { InboxItem, InboxTab } from "@/lib/api/types"

import { emptyText } from "./inbox-format"
import { InboxRow } from "./inbox-row"

const TABS: { value: InboxTab; label: string }[] = [
  { value: "important", label: "Important" },
  { value: "primary", label: "Primary" },
  { value: "all", label: "All" },
]

const isTab = (v: string | null): v is InboxTab => v === "important" || v === "primary" || v === "all"

function ListSkeleton() {
  return (
    <ul className="rounded-lg border border-line bg-surface">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="border-b border-surface-sunken px-3.5 py-3 last:border-b-0">
          <div className="h-3 w-56 animate-pulse rounded bg-surface-sunken" />
          <div className="mt-1.5 h-2.5 w-32 animate-pulse rounded bg-surface-hover" />
        </li>
      ))}
    </ul>
  )
}

function NotificationsPageInner() {
  const { accessToken, user, status } = useSession()
  const isAuthed = status === "authenticated" && !!accessToken
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  // The tab lives in the address, so a link can open a tab.
  const raw = params.get("tab")
  const tab: InboxTab = isTab(raw) ? raw : "important"
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [marked, setMarked] = useState<number | null>(null)

  const pages = useInfiniteQuery({
    queryKey: [...notificationKeys.all, "pages", tab, unreadOnly],
    queryFn: ({ pageParam }) =>
      listNotifications(accessToken!, { tab, unread: unreadOnly, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: isAuthed,
  })

  // Same key as the bell's badge, so both read one answer.
  const count = useQuery({
    queryKey: notificationKeys.count,
    queryFn: () => getUnreadCount(accessToken!),
    enabled: isAuthed,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: notificationKeys.all })

  const markRead = useMutation({
    mutationFn: (id: string) => markNotificationRead(accessToken!, id),
    onSettled: refresh,
  })

  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(accessToken!),
    onSuccess: (res) => setMarked(res.marked),
    onSettled: refresh,
  })

  const onTab = (next: InboxTab) => {
    setMarked(null)
    router.replace(`${pathname}?tab=${next}`, { scroll: false })
  }

  const onOpen = (item: InboxItem) => {
    if (item.unread) markRead.mutate(item.id)
  }

  const home = user ? ROLE_ROUTES[user.role] : ""
  const items = pages.data?.pages.flatMap((p) => p.items) ?? []
  const ready = !pages.isPending && !pages.isError
  const nothingUnread = count.isSuccess && count.data.unread === 0

  return (
    <>
      <PageHeader kicker="Overview" title="Notifications" sub="Things for you, and what happened in the app." />

      <Tabs value={tab} onValueChange={(v) => onTab(v as InboxTab)}>
        <TabsList
          variant="line"
          className="h-auto! w-full justify-start gap-6 overflow-x-auto rounded-none border-b border-line bg-transparent p-0"
        >
          {TABS.map(({ value, label }) => (
            <TabsTrigger
              key={value}
              value={value}
              className="h-auto flex-none rounded-none border-b-2 border-transparent px-0 pt-0 pb-2.5 text-body-sm font-semibold text-ink-muted transition-colors after:hidden hover:text-ink-body data-active:border-b-ink data-active:bg-transparent data-active:text-ink-body"
            >
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mt-3 space-y-3">
        {/* Hidden while the first page loads or fails: a control beside a
            skeleton reads as if it already knows the answer. */}
        {ready ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CheckboxField label="Unread only" checked={unreadOnly} onChange={setUnreadOnly} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={nothingUnread || markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              Mark all as read
            </Button>
          </div>
        ) : null}

        {marked !== null ? (
          <PanelNotice onDismiss={() => setMarked(null)}>Marked {marked} as read.</PanelNotice>
        ) : null}
        {markAll.isError ? <PanelAlert>{toMessage(markAll.error)}</PanelAlert> : null}

        {pages.isPending ? (
          <ListSkeleton />
        ) : pages.isError ? (
          <PanelAlert>
            {toMessage(pages.error)}{" "}
            <Button
              variant="link"
              onClick={() => pages.refetch()}
              className="h-auto p-0 text-caption font-bold text-danger underline"
            >
              Try again
            </Button>
          </PanelAlert>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-line bg-surface px-3.5 py-6 text-center text-body-sm text-ink-muted">
            {emptyText(tab, unreadOnly)}
          </div>
        ) : (
          <>
            <ul className="rounded-lg border border-line bg-surface">
              {items.map((item) => (
                <InboxRow key={item.id} item={item} home={home} onOpen={onOpen} />
              ))}
            </ul>
            {pages.hasNextPage ? (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pages.isFetchingNextPage}
                  onClick={() => pages.fetchNextPage()}
                >
                  {pages.isFetchingNextPage ? "Loading..." : "Load more"}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  )
}

/** One page for all five roles. `useSearchParams` needs a Suspense boundary in Next.js 16. */
export function NotificationsPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <NotificationsPageInner />
    </Suspense>
  )
}
