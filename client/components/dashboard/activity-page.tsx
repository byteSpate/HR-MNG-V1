"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { listEvents } from "@/lib/api/events"
import { useSession } from "@/lib/auth/session-context"
import type { EventItem, EventSeverity } from "@/lib/api/types"
import { ALL, FilterSelect } from "@/components/dashboard/filter-bar"
import { PageHeader } from "@/components/dashboard/page-header"
import { PanelTable } from "@/components/dashboard/record-kit"
import { Tag } from "@/components/dashboard/tag"
import type { TableCell, Tone } from "@/components/dashboard/types"
import { Button } from "@/components/ui/button"

/**
 * Everything that has happened, as far as the reader is entitled to see it.
 *
 * This route used to render a `SubpageData` mock: five invented reports owned
 * by four people who do not work here, under a stat reading "Data freshness:
 * Live · Synced 4 min ago" describing a sync that does not exist. Two real
 * "View all" links on the dashboard pointed straight into it, so genuine
 * activity led to fabricated activity.
 *
 * `GET /api/events` is real, scoped server-side, and already feeds the
 * notification bell. Scheduled reporting is not built — `server/src/modules/
 * reporting/` holds a .gitkeep and nothing else — so this page does not
 * pretend otherwise.
 */

const SEVERITY_TONE: Record<EventSeverity, Tone> = {
  INFO: "neutral",
  SUCCESS: "green",
  WARNING: "yellow",
  ERROR: "red",
}

/** "Aug 17, 10:57 AM" — the same voice the dashboard feed speaks. */
function when(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
}

function toRows(items: EventItem[]): TableCell[][] {
  return items.map((e) => [
    { text: e.title, sub: e.meta ?? undefined, weight: 500 },
    // The entity is a machine name; spaced and lower-cased it reads as English
    // without a lookup table that would drift from the server's enum.
    { text: e.entity.replace(/_/g, " ").toLowerCase(), icon: e.entity },
    {
      node: <Tag label={e.severity.toLowerCase()} tone={SEVERITY_TONE[e.severity]} />,
    },
    { text: when(e.createdAt) },
  ])
}

const PAGE_SIZE = 25

/**
 * The areas worth filtering by, in the order somebody would look for them.
 * A subset of `AuditEntity` on purpose: listing every enum value would offer
 * filters that return nothing on a system this size.
 */
const AREA_OPTIONS = [
  { value: "ASSET_REQUEST", label: "Asset requests" },
  { value: "ASSET", label: "Assets" },
  { value: "PAYROLL_RUN", label: "Payroll runs" },
  { value: "LEAVE_REQUEST", label: "Leave" },
  { value: "ATTENDANCE", label: "Attendance" },
  { value: "EXPENSE_CLAIM", label: "Expenses" },
  { value: "EMPLOYEE", label: "Employees" },
  // Role changes. Filed apart from "Employees" because this is the login and
  // what it may do, not the employment record — the same split the server
  // draws between /admin/users and /admin/employees.
  { value: "USER", label: "Accounts" },
]

const SEVERITY_OPTIONS = [
  { value: "WARNING", label: "Warning" },
  { value: "ERROR", label: "Error" },
  { value: "SUCCESS", label: "Success" },
  { value: "INFO", label: "Info" },
]

export function ActivityPage() {
  const { accessToken } = useSession()
  // How many pages deep the reader has asked to go. Walking the cursor chain
  // from the top on each change keeps this one query with one cache entry,
  // which matters because every mutation elsewhere invalidates by prefix.
  const [pageCount, setPageCount] = useState(1)
  const [area, setArea] = useState<string>(ALL)
  const [severity, setSeverity] = useState<string>(ALL)

  const filters = {
    ...(area === ALL ? {} : { entity: area }),
    ...(severity === ALL ? {} : { severity: severity as EventSeverity }),
  }
  const filtersActive = area !== ALL || severity !== ALL

  const pages = useQuery({
    queryKey: ["events", pageCount, area, severity],
    queryFn: async () => {
      const collected: EventItem[] = []
      let cursor: string | undefined
      let nextCursor: string | null = null
      for (let i = 0; i < pageCount; i++) {
        const page = await listEvents(accessToken!, { limit: PAGE_SIZE, cursor, ...filters })
        collected.push(...page.items)
        nextCursor = page.nextCursor
        if (!page.nextCursor) break
        cursor = page.nextCursor
      }
      return { items: collected, nextCursor }
    },
    enabled: !!accessToken,
  })

  function resetTo(next: () => void) {
    // Back to page one on any filter change: keeping the depth would show a
    // "load older" button for a chain that no longer exists.
    setPageCount(1)
    next()
  }

  const items = pages.data?.items ?? []

  return (
    <>
      <PageHeader
        kicker="Overview"
        title="Activity"
        sub="Every action recorded across the system, newest first."
      />

      {/* Hidden while the first page is loading or broken: filtering nothing
          is a control that cannot do anything, and a count beside a skeleton
          reads as a real answer. Same rule the employees directory applies. */}
      {/* Not `FilterBar`: that component leads with a search box, and the
          events endpoint has no text search. A search field that cannot search
          is the same defect as a status filter the server ignores. */}
      {!pages.isPending && !pages.isError ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <FilterSelect
            label="Filter by area"
            value={area}
            onChange={(v) => resetTo(() => setArea(v))}
            allLabel="All areas"
            options={AREA_OPTIONS}
          />
          <FilterSelect
            label="Filter by severity"
            value={severity}
            onChange={(v) => resetTo(() => setSeverity(v))}
            allLabel="All severities"
            options={SEVERITY_OPTIONS}
          />
          <span className="text-caption text-ink-muted tabular-nums">
            {items.length} {items.length === 1 ? "event" : "events"}
          </span>
          {filtersActive ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => resetTo(() => { setArea(ALL); setSeverity(ALL) })}
            >
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : null}

      <PanelTable
        cols="2fr 1fr 0.8fr 1fr"
        headers={["What happened", "Area", "Severity", "When"]}
        rows={toRows(items)}
        isLoading={pages.isPending}
        isError={pages.isError}
        onRetry={() => pages.refetch()}
        // Two ways to be empty, two different answers: a filter that went too
        // narrow, and a system nobody has used yet.
        emptyTitle={filtersActive ? "Nothing matches" : "Nothing has happened yet"}
        emptyBody={
          filtersActive
            ? "No recorded action matches this area and severity together. Widen one of them."
            : "Actions across the system are recorded here as people use it: approvals, payroll runs, handovers and the rest."
        }
        emptyAction={filtersActive ? "Clear filters" : "Refresh"}
        onEmptyAction={
          filtersActive
            ? () => resetTo(() => { setArea(ALL); setSeverity(ALL) })
            : () => pages.refetch()
        }
      />

      {pages.data?.nextCursor ? (
        <div className="mt-3 flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPageCount((n) => n + 1)}
          >
            Load older activity
          </Button>
        </div>
      ) : null}

      {/* Said plainly rather than left as an absence somebody reads as a bug.
          The mock this page replaced claimed four scheduled reports and a
          nightly sync, none of which exist. */}
      <p className="mt-4 text-caption text-ink-muted">
        Scheduled and exported reports are not built yet. Payslips and financial
        statements render their own PDFs from their modules.
      </p>
    </>
  )
}
