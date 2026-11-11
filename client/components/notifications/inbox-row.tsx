"use client"

import Link from "next/link"

import type { InboxItem } from "@/lib/api/types"

import { itemHref, timeAgo } from "./inbox-format"

/**
 * One notification, as the bell and the Notifications page both show it.
 *
 * Unread: bold title and a red dot. Closed (someone already decided the
 * request): "Done" under the title. Company activity has neither: it has no
 * read state, and marking it would suggest it was ever yours to clear.
 *
 * Opening a row marks it read. A row with no link still marks read on click.
 */
export function InboxRow({
  item,
  home,
  onOpen,
}: {
  item: InboxItem
  home: string
  onOpen: (item: InboxItem) => void
}) {
  const href = itemHref(home, item.href)
  const body = (
    <div className="flex items-start gap-2">
      <span
        className={`mt-1.5 size-1.5 shrink-0 rounded-full ${item.unread ? "bg-danger" : "bg-transparent"}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className={`text-body-sm text-ink-body ${item.unread ? "font-bold" : "font-medium"}`}>
          {item.unread ? <span className="sr-only">Not read: </span> : null}
          {item.title}
        </div>
        {item.meta ? <div className="text-caption text-ink-muted">{item.meta}</div> : null}
        {item.closed ? <div className="text-caption font-semibold text-ink-muted">Done</div> : null}
      </div>
      <span className="shrink-0 text-caption whitespace-nowrap text-ink-muted">{timeAgo(item.createdAt)}</span>
    </div>
  )

  const mine = item.source === "MINE"
  const rowClass = "block w-full px-3.5 py-2.5 text-left transition-colors hover:bg-surface-hover"

  return (
    <li className="border-b border-surface-sunken last:border-b-0">
      {href ? (
        <Link href={href} className={rowClass} onClick={() => (mine ? onOpen(item) : undefined)}>
          {body}
        </Link>
      ) : mine ? (
        <button type="button" className={rowClass} onClick={() => onOpen(item)}>
          {body}
        </button>
      ) : (
        <div className="px-3.5 py-2.5">{body}</div>
      )}
    </li>
  )
}
