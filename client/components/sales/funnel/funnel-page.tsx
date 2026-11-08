"use client"

/**
 * The Funnel page (revision §27.14).
 *
 * An employee lands on their own grid. An admin lands on the team list and
 * opens one person from it, which is how the Saturday meeting is actually run
 * (§27.17) — there is no combined grid of everybody's deals.
 */

import { useMemo, useState } from "react"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiArrowLeftLine, RiArrowRightLine, RiCheckLine } from "@remixicon/react"

import { PageHeader } from "@/components/dashboard/page-header"
import { useSalesPermissions } from "@/components/sales/shared/use-sales-permissions"
import { PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  completeFunnelMeeting,
  addManagementNote,
  editFunnelCell,
  getFunnel,
  getFunnelMeeting,
  getFunnelTeam,
  listTakeOuts,
  openFunnelMeeting,
  reopenFunnelMeeting,
  setMeetingAttendees,
  setMeetingNote,
  setPersonReviewed,
} from "@/lib/api/sales/funnel"
import { funnelKeys, funnelWriteKeys } from "@/lib/api/sales/funnel-keys"
import type { FunnelCellField, FunnelQueryOptions, FunnelSort } from "@/lib/api/types"
import { useSession } from "@/lib/auth/session-context"
import { nextPerson } from "@/lib/funnel-nav"
import { cn } from "@/lib/utils"
import { BeforeQuotationView } from "@/components/sales/opportunities/before-quotation-view"

import { FunnelFilters } from "./funnel-filters"
import { FunnelGridTable } from "./funnel-grid"
import { FunnelMeetingPanel } from "./funnel-meeting"
import { PersonWeekPanel } from "./person-week"
import { RowPanel } from "./row-panel"
import { FunnelTeamList } from "./funnel-team"
import { quarterOptions } from "./funnel-labels"
import { FunnelSummaryStrip, QuarterPicker } from "./funnel-summary"

/** Sorted and nothing else: the filters every open grid starts from. */
const DEFAULT_FILTERS: FunnelQueryOptions = { sort: "offeredOn", direction: "desc" }

/**
 * The accounts the Account filter offers, and whose grid they were read from.
 *
 * Read from the rows the grid has returned, not from the filtered result: once
 * one account is picked, the rows hold only that account, and an option list
 * built from them would shrink to it and leave no way to pick another.
 */
interface SeenAccounts {
  owner: string | null
  names: Record<string, string>
}

export function FunnelPage() {
  const { accessToken, user, status } = useSession()
  const queryClient = useQueryClient()
  const isAuthed = status === "authenticated" && Boolean(accessToken)
  const isAdmin = user?.salesRole === "SALES_ADMIN" || user?.role === "SUPER_ADMIN"
  // A Sales Admin can switch editing the Funnel off for Sales Users. For
  // looks only: the server refuses an edit either way.
  const { can } = useSalesPermissions()
  // Reading the team and other people's grids. The Funnel Meeting, "mark
  // walked" and Management Notes stay `isAdmin`: they have no switch.
  const canTeam = isAdmin || can("team.funnel")

  /** Which person's grid is open. Null means the admin is on the team list. */
  const [openEmployeeId, setOpenEmployeeId] = useState<string | null>(null)
  const [filters, setFilters] = useState<FunnelQueryOptions>(DEFAULT_FILTERS)
  const [seen, setSeen] = useState<SeenAccounts>({ owner: null, names: {} })
  // The quarter the strip and the team figures measure (owner, 2026-10-13).
  const quarters = useMemo(() => quarterOptions(new Date()), [])
  const [teamQuarter, setTeamQuarter] = useState(quarters[0].value)

  // An admin starts on the team list; everyone else on their own grid.
  const showingTeam = canTeam && openEmployeeId === null

  const gridOptions = useMemo<FunnelQueryOptions>(
    () => ({ ...filters, employeeId: openEmployeeId ?? undefined }),
    [filters, openEmployeeId]
  )

  const gridQuery = useQuery({
    queryKey: funnelKeys.grid(gridOptions),
    queryFn: () => getFunnel(gridOptions, accessToken!),
    enabled: isAuthed && !showingTeam,
    // A filter or a sort is a new key, and without this the grid and its
    // filter bar would unmount into a skeleton on every change and take
    // keyboard focus with them. Kept only within one person's grid: another
    // person's rows under this person's name would be worse than a skeleton.
    placeholderData: (previous, previousQuery) =>
      (previousQuery?.queryKey[3] as FunnelQueryOptions | undefined)?.employeeId ===
      gridOptions.employeeId
        ? previous
        : undefined,
  })

  const teamQuery = useQuery({
    queryKey: funnelKeys.team(teamQuarter),
    queryFn: () => getFunnelTeam(accessToken!, teamQuarter),
    placeholderData: (previous) => previous,
    enabled: isAuthed && canTeam,
  })

  const meetingQuery = useQuery({
    queryKey: funnelKeys.meeting(),
    queryFn: () => getFunnelMeeting(undefined, accessToken!),
    enabled: isAuthed && isAdmin,
  })

  const refresh = () => {
    for (const key of funnelWriteKeys) {
      void queryClient.invalidateQueries({ queryKey: key })
    }
  }

  const editCell = useMutation({
    mutationFn: (input: { opportunityId: string; field: FunnelCellField; value: string | null }) =>
      editFunnelCell(
        {
          opportunityId: input.opportunityId,
          edit: { field: input.field, value: input.value },
          // An edit made while a meeting is open is attributed to it (§27.7).
          // Only a Sales Admin may say so: the server refuses anybody else,
          // so a Sales User's edit never carries the field at all.
          funnelMeetingId:
            isAdmin && meetingQuery.data?.status === "SCHEDULED" ? meetingQuery.data.id : null,
        },
        accessToken!
      ),
    onSuccess: refresh,
  })

  const meetingAction = useMutation({
    mutationFn: async (action: {
      kind: string
      employeeId?: string
      note?: string | null
      reviewed?: boolean
    }) => {
      const id = meetingQuery.data?.id
      switch (action.kind) {
        case "open":
          return openFunnelMeeting({}, accessToken!)
        case "complete":
          return completeFunnelMeeting(id!, accessToken!)
        case "reopen":
          return reopenFunnelMeeting(id!, accessToken!)
        case "note":
          return setMeetingNote(id!, action.note ?? null, accessToken!)
        case "attendees": {
          const current = meetingQuery.data?.attendees.map((a) => a.employeeId) ?? []
          const next = current.includes(action.employeeId!)
            ? current.filter((x) => x !== action.employeeId)
            : [...current, action.employeeId!]
          return setMeetingAttendees(id!, next, accessToken!)
        }
        case "reviewed":
          return setPersonReviewed(
            id!,
            { employeeId: action.employeeId!, reviewed: action.reviewed ?? true },
            accessToken!
          )
        default:
          throw new Error("Unknown action")
      }
    },
    onSuccess: refresh,
  })

  const managementNote = useMutation({
    mutationFn: (input: { opportunityId: string; body: string }) =>
      addManagementNote(meetingQuery.data!.id, input, accessToken!),
    onSuccess: refresh,
  })

  const onEdit = async (opportunityId: string, field: FunnelCellField, value: string | null) => {
    await editCell.mutateAsync({ opportunityId, field, value })
  }

  const onSort = (sort: FunnelSort) => {
    setFilters((prev) => ({
      ...prev,
      sort,
      // Clicking the column you are already sorted by turns the arrow round.
      direction: prev.sort === sort && prev.direction === "desc" ? "asc" : "desc",
    }))
  }

  const grid = gridQuery.data

  // The Saturday page (owner, 2026-11-02): the side panel, the switch between
  // the quoted funnel and Before Quotation, and the open take-outs by
  // Opportunity so each row can show its count.
  const [panelId, setPanelId] = useState<string | null>(null)
  const [funnelView, setFunnelView] = useState<"QUOTED" | "BEFORE">("QUOTED")
  const personId = grid?.employeeId
  const openTakeOuts = useQuery({
    queryKey: funnelKeys.takeOuts(personId ?? "", "open"),
    queryFn: () => listTakeOuts({ employeeId: personId!, status: "PENDING" }, accessToken!),
    enabled: isAuthed && !!personId && !showingTeam,
  })
  const takeOutsByDeal = useMemo(() => {
    const byDeal: Record<string, { count: number; latest: string; at: string }> = {}
    for (const task of openTakeOuts.data?.items ?? []) {
      if (!task.opportunityId) continue
      const seen = byDeal[task.opportunityId]
      byDeal[task.opportunityId] = {
        count: (seen?.count ?? 0) + 1,
        latest: !seen || task.createdAt > seen.at ? task.title : seen.latest,
        at: !seen || task.createdAt > seen.at ? task.createdAt : seen.at,
      }
    }
    return byDeal
  }, [openTakeOuts.data])

  // Accounts seen while no account was picked. Adjusted during render, React's
  // own pattern for state that follows a query result; an effect would render
  // the stale list once first. A different person's grid starts the set over.
  if (grid) {
    const sameOwner = seen.owner === grid.employeeId
    const names: Record<string, string> = sameOwner ? { ...seen.names } : {}
    let changed = !sameOwner
    if (!filters.salesAccountId) {
      for (const row of grid.rows) {
        if (names[row.salesAccountId] !== row.accountName) {
          names[row.salesAccountId] = row.accountName
          changed = true
        }
      }
    }
    if (changed) setSeen({ owner: grid.employeeId, names })
  }

  const accounts = useMemo(
    () =>
      Object.entries(seen.names)
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [seen.names]
  )

  // The first page of this person's grid has arrived at least once. Filters
  // are hidden until then (a count beside a skeleton reads as an answer), but
  // not after: a later failed refetch must leave the filters to change back.
  const firstPageSeen =
    seen.owner !== null && (openEmployeeId === null || seen.owner === openEmployeeId)

  const filtersActive = Boolean(
    filters.status || filters.salesAccountId || filters.hideClosed || filters.changedLastWeek || filters.inQuarter
  )

  // Opening or leaving a person's grid starts it afresh: an account picked on
  // one person's funnel means nothing on another's, and a refusal from the
  // last screen is not news on this one.
  const goTo = (employeeId: string | null) => {
    setOpenEmployeeId(employeeId)
    setPanelId(null)
    setFilters(DEFAULT_FILTERS)
    setSeen({ owner: null, names: {} })
    meetingAction.reset()
  }

  if (!isAuthed) {
    return <Skeleton className="h-64 w-full bg-line" />
  }

  // ── the admin's team list ──
  if (showingTeam) {
    return (
      <div className="space-y-4">
        <PageHeader
          kicker="Sales Hub"
          title="Funnel"
          sub="Every quoted Opportunity, per person, reviewed each Saturday."
        />

        {teamQuery.isError ? <PanelAlert>{toMessage(teamQuery.error)}</PanelAlert> : null}

        {teamQuery.data ? (
          <>
            {/* Loading, broken and "no meeting open" are three different
                screens. A dead meeting endpoint must not read as an empty
                week, or it would offer to open a second meeting. */}
            {/* The Funnel Meeting has no switch: opening it, marking people
                reviewed and handing out action items stay with Sales Admins.
                A Sales User who may read the team (`team.funnel`) gets the
                list alone, with no control that cannot work for them. */}
            {!isAdmin ? null : meetingQuery.isError && meetingQuery.data === undefined ? (
              <div className="space-y-2 rounded-lg border border-line bg-white px-4 py-4">
                <PanelAlert>{toMessage(meetingQuery.error)}</PanelAlert>
                <Button variant="outline" size="sm" onClick={() => void meetingQuery.refetch()}>
                  Try again
                </Button>
              </div>
            ) : meetingQuery.isLoading ? (
              <Skeleton className="h-28 w-full bg-line" />
            ) : (
              <FunnelMeetingPanel
                meeting={meetingQuery.data ?? null}
                team={teamQuery.data}
                busy={meetingAction.isPending}
                error={meetingAction.isError ? meetingAction.error : null}
                onOpen={() => meetingAction.mutate({ kind: "open" })}
                onToggleAttendee={(employeeId) =>
                  meetingAction.mutate({ kind: "attendees", employeeId })
                }
                onSaveNote={(note) => meetingAction.mutate({ kind: "note", note })}
                onComplete={() => meetingAction.mutate({ kind: "complete" })}
                onReopen={() => meetingAction.mutate({ kind: "reopen" })}
              />
            )}
            <QuarterPicker value={teamQuarter} options={quarters} onChange={setTeamQuarter} />
            <FunnelTeamList team={teamQuery.data} onOpen={goTo} />
          </>
        ) : teamQuery.isError ? null : (
          // Loading, empty and broken are three different screens. No counts
          // are shown beside a skeleton, and a failure shows its alert alone.
          <Skeleton className="h-64 w-full bg-line" />
        )}
      </div>
    )
  }

  // ── one person's grid ──
  const meetingOpen = meetingQuery.data?.status === "SCHEDULED"
  const alreadyWalked =
    grid && meetingQuery.data
      ? meetingQuery.data.reviewed.some((r) => r.employeeId === grid.employeeId)
      : false

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Sales Hub"
        title={canTeam && grid ? `${grid.employeeName}'s funnel` : "Funnel"}
        sub="Every Opportunity quoted, newest first. One joins when its quotation goes out, and stays here afterwards."
      />

      <div className="flex flex-wrap items-center gap-2">
        {canTeam ? (
          <Button variant="outline" onClick={() => goTo(null)}>
            <RiArrowLeftLine className="size-4" aria-hidden />
            Back to the team
          </Button>
        ) : null}

        {/* Marking somebody walked only means anything inside an open meeting
            (§27.11), so the button is absent rather than disabled when there
            is none — a control that cannot do anything is a bug. */}
        {isAdmin && meetingOpen && grid ? (
          alreadyWalked ? (
            <>
              <span className="inline-flex items-center gap-1 rounded-full bg-success-tint px-3 py-1 text-sm font-medium text-success">
                <RiCheckLine className="size-4" aria-hidden />
                Walked this week
              </span>
              {/* The server takes a mark back off as readily as it puts one on;
                  a mark made on the wrong person's grid needs a way back. */}
              <Button
                variant="outline"
                onClick={() =>
                  meetingAction.mutate({
                    kind: "reviewed",
                    employeeId: grid.employeeId,
                    reviewed: false,
                  })
                }
                disabled={meetingAction.isPending}
              >
                Take the mark off
              </Button>
            </>
          ) : (
            <Button
              onClick={() => meetingAction.mutate({ kind: "reviewed", employeeId: grid.employeeId })}
              disabled={meetingAction.isPending}
            >
              Mark walked
            </Button>
          )
        ) : null}

        {/* The admin walks the team one person at a time, in the team list's
            order (owner, 2026-11-02). In an open meeting this also marks the
            person walked, so one tap does both. */}
        {canTeam && grid && teamQuery.data && nextPerson(teamQuery.data.rows, grid.employeeId) ? (
          <Button
            variant="outline"
            disabled={meetingAction.isPending}
            onClick={() => {
              const next = nextPerson(teamQuery.data!.rows, grid.employeeId)!
              if (isAdmin && meetingOpen && !alreadyWalked) {
                meetingAction.mutate({ kind: "reviewed", employeeId: grid.employeeId }, { onSuccess: () => goTo(next) })
              } else {
                goTo(next)
              }
            }}
          >
            {isAdmin && meetingOpen && !alreadyWalked ? "Mark walked and go to the next person" : "Next person"}
            <RiArrowRightLine className="size-4" aria-hidden />
          </Button>
        ) : null}
      </div>

      {/* Asked as soon as we know whose page it is, not after the grid has come
          back, so the week and the grid load side by side. */}
      {(openEmployeeId ?? grid?.employeeId) ? (
        <PersonWeekPanel employeeId={(openEmployeeId ?? grid?.employeeId)!} isAdmin={isAdmin} />
      ) : null}

      {grid ? (
        <div role="tablist" aria-label="Which Opportunities" className="flex flex-wrap gap-2">
          {(["QUOTED", "BEFORE"] as const).map((view) => (
            <Button
              key={view}
              type="button"
              role="tab"
              aria-selected={funnelView === view}
              onClick={() => setFunnelView(view)}
              className={
                funnelView === view
                  ? "h-9 rounded-md bg-ink px-3 text-caption font-bold text-white hover:bg-ink-strong"
                  : "h-9 rounded-md border border-line bg-white px-3 text-caption font-bold text-ink hover:bg-surface-subtle"
              }
            >
              {view === "QUOTED" ? "Quoted" : "Before Quotation"}
            </Button>
          ))}
        </div>
      ) : null}

      {gridQuery.isError ? <PanelAlert>{toMessage(gridQuery.error)}</PanelAlert> : null}
      {editCell.isError ? <PanelAlert>{toMessage(editCell.error)}</PanelAlert> : null}
      {managementNote.isError ? <PanelAlert>{toMessage(managementNote.error)}</PanelAlert> : null}
      {meetingAction.isError ? <PanelAlert>{toMessage(meetingAction.error)}</PanelAlert> : null}

      {grid && funnelView === "BEFORE" ? (
        <BeforeQuotationView
          ownerEmployeeId={grid.employeeId}
          showFilters={false}
          onOpenOpportunity={(deal) => setPanelId(deal.id)}
        />
      ) : null}

      {funnelView === "QUOTED" ? (
      <>
      {/* Outside the loading branch, so a filter or sort change keeps the bar
          (and the focus in it). Only the very first page hides it. The totals
          go while a new view is loading: the old view's figure beside the new
          view's spinner would read as its answer. */}
      {/* The quarter strip (owner, 2026-10-13). Hidden while a new view loads,
          for the same reason as the totals. */}
      {firstPageSeen ? (
        <div className="space-y-3 rounded-lg border border-line bg-surface-subtle px-4 py-3">
          <div className="flex flex-wrap items-end gap-4">
            <QuarterPicker
              value={filters.quarter ?? quarters[0].value}
              options={quarters}
              onChange={(quarter) => setFilters((prev) => ({ ...prev, quarter }))}
            />
            <label className="flex items-center gap-2 pb-1.5 text-sm">
              <input
                type="checkbox"
                checked={Boolean(filters.inQuarter)}
                onChange={(e) => setFilters((prev) => ({ ...prev, inQuarter: e.target.checked || undefined }))}
                className="size-4 rounded border-line-strong"
              />
              Only rows closing in this quarter
            </label>
          </div>
          {grid && !gridQuery.isPlaceholderData ? <FunnelSummaryStrip summary={grid.summary} /> : null}
        </div>
      ) : null}

      {firstPageSeen ? (
        <FunnelFilters
          value={filters}
          onChange={setFilters}
          accounts={accounts}
          totals={gridQuery.isPlaceholderData ? undefined : grid?.totals}
        />
      ) : null}

      {grid ? (
        <>
          <div
            aria-busy={gridQuery.isPlaceholderData}
            className={cn(
              gridQuery.isPlaceholderData && "opacity-60 transition-opacity motion-reduce:transition-none"
            )}
          >
            <FunnelGridTable
              grid={grid}
              editable={can("funnel.edit_cell")}
              sort={filters.sort ?? "offeredOn"}
              direction={filters.direction ?? "desc"}
              onSort={onSort}
              onEdit={onEdit}
              canAddManagementNote={isAdmin && meetingOpen}
              onAddManagementNote={async (opportunityId, body) => {
                await managementNote.mutateAsync({ opportunityId, body })
              }}
              filtersActive={filtersActive}
              onClearFilters={() => setFilters({ sort: filters.sort, direction: filters.direction, quarter: filters.quarter })}
              takeOuts={takeOutsByDeal}
              onOpenPanel={setPanelId}
            />
          </div>
          <p className={cn("text-xs", TONE.muted)}>
            Open a row to see every quote, the stage, the products and the remarks. Quotes, products
            and the status change on the Opportunity itself.
          </p>
        </>
      ) : gridQuery.isError ? null : (
        // Broken shows its alert alone; a skeleton beside it would read as
        // still loading.
        <Skeleton className="h-96 w-full bg-line" />
      )}
      </>
      ) : null}

      {grid ? (
        <RowPanel
          opportunityId={panelId}
          employeeId={grid.employeeId}
          employeeName={grid.employeeName}
          isAdmin={isAdmin}
          showQuotes={funnelView === "QUOTED"}
          onClose={() => setPanelId(null)}
        />
      ) : null}
    </div>
  )
}
