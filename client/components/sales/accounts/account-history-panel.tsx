"use client"

import { useQuery } from "@tanstack/react-query"
import { RiArrowRightLine } from "@remixicon/react"

import { getAccountHistory } from "@/lib/api/sales/accounts"
import { useSession } from "@/lib/auth/session-context"
import type { AccountHistoryEntry, HistoryChange } from "@/lib/api/types"
import { Tag } from "@/components/dashboard/tag"
import { HISTORY_ENTITY_ICON } from "@/components/sales/shared/sales-shared"
import { formatMoment } from "@/components/sales/accounts/account-timeline-panel"
import { Panel, PanelError, PanelHeading, PanelSkeleton } from "@/components/sales/shared/panel"

/** CREATE / UPDATE / DELETE, said the way a person would say it. */
const ACTION_LABEL: Record<string, string> = {
  CREATE: "Created",
  UPDATE: "Updated",
  DELETE: "Deleted",
}

/**
 * One changed field, as a labelled row rather than a fragment of JSON.
 *
 * A change with no `before` was set for the first time, so it shows a single
 * value — an arrow from nothing reads as though something was lost.
 */
function ChangeRow({ change }: { change: HistoryChange }) {
  return (
    <div className="grid grid-cols-[minmax(88px,38%)_minmax(0,1fr)] gap-x-3 gap-y-0.5 py-1 text-caption">
      <dt className="truncate text-ink-muted">{change.label}</dt>
      <dd className="m-0 min-w-0 break-words text-ink-body">
        {change.before === null ? (
          <span className="font-medium">{change.after}</span>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className="text-ink-muted line-through decoration-line-strong">{change.before}</span>
            <RiArrowRightLine className="size-3 shrink-0 text-ink-muted" aria-hidden />
            <span className="font-medium">{change.after}</span>
          </span>
        )}
      </dd>
    </div>
  )
}

function HistoryRow({ entry, delayMs }: { entry: AccountHistoryEntry; delayMs: number }) {
  const Icon = HISTORY_ENTITY_ICON[entry.entity]
  return (
    <li
      className="rise-in border-b border-surface-sunken py-3 last:border-b-0"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Icon className="size-3.5 shrink-0 text-ink-muted" aria-hidden />
        <Tag label={entry.entity === "SALES_ACCOUNT" ? "Account" : "Contact"} tone="neutral" />
        <span className="text-caption font-semibold text-ink-body">
          {ACTION_LABEL[entry.action] ?? entry.action}
        </span>
        <span className="text-caption text-ink-muted">
          {formatMoment(entry.changedAt)}
          {entry.changedByName ? ` · ${entry.changedByName}` : ""}
        </span>
      </div>

      {entry.changes.length > 0 ? (
        <dl className="mt-1.5 divide-y divide-surface-hover rounded-md bg-surface-subtle px-3 py-1">
          {entry.changes.map((change) => (
            <ChangeRow key={change.field} change={change} />
          ))}
        </dl>
      ) : null}

      {entry.note ? (
        <div className="mt-1.5 text-caption text-ink-soft italic">{entry.note}</div>
      ) : null}
    </li>
  )
}

export function AccountHistoryPanel({ accountId }: { accountId: string }) {
  const { accessToken } = useSession()
  const historyQuery = useQuery({
    queryKey: ["sales", "accounts", accountId, "history"],
    queryFn: () => getAccountHistory(accessToken!, accountId),
    enabled: !!accessToken,
  })

  if (historyQuery.isPending) return <PanelSkeleton />
  if (historyQuery.isError) return <PanelError onRetry={() => historyQuery.refetch()} />

  const entries = historyQuery.data?.items ?? []
  const truncated = historyQuery.data?.truncated ?? false

  return (
    <Panel>
      <PanelHeading title="History" />
      {entries.length === 0 ? (
        <p className="py-4 text-center text-caption text-ink-muted">No changes recorded yet.</p>
      ) : (
        <>
          <ul>
            {entries.map((entry, i) => (
              <HistoryRow key={entry.id} entry={entry} delayMs={Math.min(i, 8) * 24} />
            ))}
          </ul>
          {/* Said rather than hidden: a capped list that does not admit it is
              capped reads as the whole story. Paging arrives with Phase 2. */}
          {truncated ? (
            <p className="mt-3 border-t border-surface-sunken pt-3 text-center text-caption text-ink-muted">
              Showing the {historyQuery.data?.limit} most recent changes. Older ones are kept but
              not shown here yet.
            </p>
          ) : null}
        </>
      )}
    </Panel>
  )
}
