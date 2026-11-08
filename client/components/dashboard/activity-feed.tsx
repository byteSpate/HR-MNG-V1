import Link from "next/link"

import { Tag } from "@/components/dashboard/tag"
import { tones } from "@/components/dashboard/types"
import type { DashboardActivityItem } from "@/lib/api/types"

/**
 * "2026-08-14T10:00:00.000Z" → "Aug 14".
 *
 * An absolute stamp rather than "2h ago": a relative one has to read the
 * clock during render, which makes the component impure and its output
 * dependent on when React happened to re-render it.
 */
const stamp = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })

export function ActivityFeed({
  items,
  viewAllHref,
}: {
  items: DashboardActivityItem[]
  viewAllHref: string
}) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-white px-4 py-4 sm:px-5.5 sm:py-5">
      <div className="mb-3.5 flex items-center justify-between">
        <div className="text-lead font-bold">Recent activity</div>
        <Link href={viewAllHref} className="text-caption font-semibold hover:underline pointer-coarse:py-3">
          View all
        </Link>
      </div>

      {items.length === 0 ? (
        // An empty state, not a spinner that never resolves. A new employee
        // genuinely has no history, and that is a fact rather than a failure.
        <div className="py-6 text-body-sm text-ink-muted">
          Nothing has happened yet. Activity shows up here as you use the system.
        </div>
      ) : (
        <div className="flex flex-col">
          {items.map((item, i) => (
            <div
              key={`${item.time}-${item.title}`}
              className="flex items-center gap-3.5 py-2.5"
              style={{ borderTop: i === 0 ? "none" : "1px solid #EEF1F5" }}
            >
              <div
                className="grid size-8.5 shrink-0 place-items-center rounded text-body-sm font-extrabold"
                style={{ background: tones[item.tone].bg, color: tones[item.tone].color }}
              >
                {item.initial}
              </div>
              <div className="min-w-0 flex-1 leading-snug">
                <div className="text-body-sm font-semibold">{item.title}</div>
                <div className="text-xs text-ink-muted">{item.meta}</div>
              </div>
              {item.status ? <Tag label={item.status} tone={item.statusTone ?? "neutral"} /> : null}
              <span className="w-14 shrink-0 text-right text-caption text-ink-muted">
                {stamp(item.time)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
