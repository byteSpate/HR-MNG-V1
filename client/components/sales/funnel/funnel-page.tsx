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
import { RiArrowLeftLine, RiCheckLine } from "@remixicon/react"

import { PageHeader } from "@/components/dashboard/page-header"
import { PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  completeFunnelMeeting,
  editFunnelCell,
  getFunnel,
  getFunnelMeeting,
  getFunnelTeam,
  openFunnelMeeting,
  reopenFunnelMeeting,
  setMeetingAttendees,
  setMeetingNote,
  setPersonReviewed,
} from "@/lib/api/funnel"
import { funnelKeys, funnelWriteKeys } from "@/lib/api/funnel-keys"
import type { FunnelCellField, FunnelQueryOptions, FunnelSort } from "@/lib/api/types"
import { useSession } from "@/lib/auth/session-context"
import { cn } from "@/lib/utils"

import { FunnelFilters } from "./funnel-filters"
import { FunnelGridTable } from "./funnel-grid"
import { FunnelMeetingPanel } from "./funnel-meeting"
import { FunnelTeamList } from "./funnel-team"

export function FunnelPage() {
  const { accessToken, user, status } = useSession()
  const queryClient = useQueryClient()
  const isAuthed = status === "authenticated" && Boolean(accessToken)
  const isAdmin = user?.salesRole === "SALES_ADMIN" || user?.role === "SUPER_ADMIN"

  /** Which person's grid is open. Null means the admin is on the team list. */
  const [openEmployeeId, setOpenEmployeeId] = useState<string | null>(null)
  const [filters, setFilters] = useState<FunnelQueryOptions>({
    sort: "offeredOn",
    direction: "desc",
  })

  // An admin starts on the team list; everyone else on their own grid.
  const showingTeam = isAdmin && openEmployeeId === null

  const gridOptions = useMemo<FunnelQueryOptions>(
    () => ({ ...filters, employeeId: openEmployeeId ?? undefined }),
    [filters, openEmployeeId]
  )

  const gridQuery = useQuery({
    queryKey: funnelKeys.grid(gridOptions),
    queryFn: () => getFunnel(gridOptions, accessToken!),
    enabled: isAuthed && !showingTeam,
  })

  const teamQuery = useQuery({
    queryKey: funnelKeys.team(),
    queryFn: () => getFunnelTeam(accessToken!),
    enabled: isAuthed && isAdmin,
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
          funnelMeetingId: meetingQuery.data?.status === "SCHEDULED" ? meetingQuery.data.id : null,
        },
        accessToken!
      ),
    onSuccess: refresh,
  })

  const meetingAction = useMutation({
    mutationFn: async (action: { kind: string; employeeId?: string; note?: string | null }) => {
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
            { employeeId: action.employeeId!, reviewed: true },
            accessToken!
          )
        default:
          throw new Error("Unknown action")
      }
    },
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

  // The accounts the filter offers are the ones actually in this grid. A
  // filter listing accounts with no quoted deals could only ever empty it.
  const accounts = useMemo(() => {
    if (!grid) return []
    const seen = new Map<string, string>()
    for (const row of grid.rows) seen.set(row.salesAccountId, row.accountName)
    return [...seen]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [grid])

  if (!isAuthed) {
    return <Skeleton className="h-64 w-full" />
  }

  // ── the admin's team list ──
  if (showingTeam) {
    return (
      <div className="space-y-4">
        <PageHeader
          kicker="Sales Hub"
          title="Funnel"
          sub="Every quoted deal, per person, reviewed each Saturday."
        />

        {teamQuery.isError ? <PanelAlert>{toMessage(teamQuery.error)}</PanelAlert> : null}

        {teamQuery.isLoading || !teamQuery.data ? (
          // Loading, empty and broken are three different screens. No counts
          // are shown beside a skeleton.
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
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
            <FunnelTeamList team={teamQuery.data} onOpen={setOpenEmployeeId} />
          </>
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
        title={isAdmin && grid ? `${grid.employeeName}'s funnel` : "Funnel"}
        sub="Every deal quoted, newest first. A deal joins when its quotation goes out, and stays here afterwards."
      />

      <div className="flex flex-wrap items-center gap-2">
        {isAdmin ? (
          <Button variant="outline" onClick={() => setOpenEmployeeId(null)}>
            <RiArrowLeftLine className="size-4" aria-hidden />
            Back to the team
          </Button>
        ) : null}

        {/* Marking somebody walked only means anything inside an open meeting
            (§27.11), so the button is absent rather than disabled when there
            is none — a control that cannot do anything is a bug. */}
        {isAdmin && meetingOpen && grid ? (
          alreadyWalked ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#E6F4EA] px-3 py-1 text-sm font-medium text-[#0B7A3B]">
              <RiCheckLine className="size-4" aria-hidden />
              Walked this week
            </span>
          ) : (
            <Button
              onClick={() => meetingAction.mutate({ kind: "reviewed", employeeId: grid.employeeId })}
              disabled={meetingAction.isPending}
            >
              Mark walked
            </Button>
          )
        ) : null}
      </div>

      {gridQuery.isError ? <PanelAlert>{toMessage(gridQuery.error)}</PanelAlert> : null}
      {editCell.isError ? <PanelAlert>{toMessage(editCell.error)}</PanelAlert> : null}

      {gridQuery.isLoading || !grid ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          <FunnelFilters
            value={filters}
            onChange={setFilters}
            accounts={accounts}
            totals={grid.totals}
          />
          <FunnelGridTable
            grid={grid}
            editable
            sort={filters.sort ?? "offeredOn"}
            direction={filters.direction ?? "desc"}
            onSort={onSort}
            onEdit={onEdit}
          />
          <p className={cn("text-xs", TONE.muted)}>
            Brand, model, quantity and the deal&apos;s status are changed on the deal itself. Open a
            row to reach it.
          </p>
        </>
      )}
    </div>
  )
}
