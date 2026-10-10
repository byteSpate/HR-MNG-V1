"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { bulkDecideAttendance, getApprovals } from "@/lib/api/attendance"
import { ApiError } from "@/lib/api/client"
import { PanelAlert, PanelTable } from "@/components/dashboard/record-kit"
import { SegmentedToggle } from "@/components/dashboard/segmented-toggle"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { TableCell } from "@/components/dashboard/types"
import { DecisionDialog } from "@/components/leave/decision-dialog"
import {
  EXCEPTION_LABEL,
  formatClock,
  formatDayLabel,
  formatHours,
} from "@/components/attendance/attendance-shared"
import { SectionHeading } from "@/components/attendance/attendance-ui"

const TAB_OPTIONS = [
  { value: "PENDING", label: "Needs review" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
] as const

/**
 * The manager's queue. **Every closed day lands here** — nothing approves
 * itself, because a web punch proves identity and server time, never that
 * the person was actually at work. The approver's own knowledge of who was
 * there is the control.
 *
 * Rows still lead with their exception labels where they have any, so the
 * eye goes to the odd ones first. Those labels direct attention within the
 * list; they never shorten it.
 */
export function ApprovalsSection({
  accessToken,
  isHr,
}: {
  accessToken: string
  isHr: boolean
}) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<"PENDING" | "APPROVED" | "REJECTED">("PENDING")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rejecting, setRejecting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const approvalsQuery = useQuery({
    queryKey: ["attendance", "approvals", tab],
    queryFn: () => getApprovals(accessToken, tab),
    // Polling, not a socket: at this headcount it is within a rounding error
    // of a live feed and adds no stateful connection to the API.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })

  const items = useMemo(() => approvalsQuery.data ?? [], [approvalsQuery.data])

  const decideMutation = useMutation({
    mutationFn: (vars: { ids: string[]; decision: "APPROVE" | "REJECT"; note?: string }) =>
      bulkDecideAttendance(accessToken, vars.ids, vars.decision, vars.note),
    onSuccess: (results) => {
      const failures = results.filter((r) => !r.ok)
      // Per-id results, so a batch that partly worked says so rather than
      // reporting a blanket failure.
      setActionError(
        failures.length > 0
          ? `${failures.length} of ${results.length} could not be decided: ${failures[0]?.error ?? ""}`
          : null
      )
      setSelected(new Set())
      setRejecting(false)
      queryClient.invalidateQueries({ queryKey: ["attendance"] })
    },
    onError: (err) => {
      setActionError(
        err instanceof ApiError ? err.message : "Something went wrong. Please try again."
      )
    },
  })

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = items.length > 0 && selected.size === items.length
  const isPending = tab === "PENDING"

  const rows: TableCell[][] = items.map((item) => [
    {
      node: isPending ? (
        <div className="flex items-center py-0.5">
          <Checkbox
            checked={selected.has(item.id)}
            onCheckedChange={() => toggle(item.id)}
            aria-label={`Select ${item.employee.fullName} on ${item.date}`}
          />
        </div>
      ) : (
        <span />
      ),
    },
    {
      // The reason leads, not the date: it is what the decision turns on.
      // A day with no flags is still reviewed, so it says which kind of day
      // it is rather than leaving the column looking unpopulated.
      text: item.exceptions.map((code) => EXCEPTION_LABEL[code]).join(", ") || "Routine day",
      weight: 600,
      sub: item.regularisedNote ?? undefined,
    },
    { text: item.employee.fullName, sub: item.employee.employeeCode },
    { text: formatDayLabel(item.date) },
    // Built as a sentence rather than joined with a separator: a missing
    // check-out is the single most common reason a record reaches this queue,
    // and "9:00 AM to " with nothing after it is the case that matters most.
    {
      text:
        item.checkIn && item.checkOut
          ? `${formatClock(item.checkIn)} to ${formatClock(item.checkOut)}`
          : item.checkIn
            ? formatClock(item.checkIn)
            : "Nothing recorded",
      sub: item.checkIn && !item.checkOut ? "No check-out" : undefined,
    },
    { text: formatHours(item.workedHours) },
    item.stalled
      ? { tag: `${item.agingDays}d waiting`, tone: "red" }
      : { text: item.agingDays > 0 ? `${item.agingDays}d` : "Today" },
  ])

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeading
          title={isHr ? "Attendance approvals" : "Approvals for my team"}
          sub="Every day that has closed waits here until a manager approves it. A flag marks a day to look at more closely."
        />
        <SegmentedToggle
          label="Queue shown"
          value={tab}
          options={TAB_OPTIONS}
          onChange={(next) => {
            setTab(next)
            setSelected(new Set())
          }}
          className="mb-3.5 shrink-0"
        />
      </div>

      {isPending && items.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-[#E4E9EF] bg-white px-4 py-3">
          <Checkbox
            checked={allSelected}
            onCheckedChange={() =>
              setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))
            }
            aria-label="Select all"
          />
          <span className="text-[12.5px] font-semibold">
            {selected.size > 0 ? `${selected.size} selected` : "Select all"}
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              disabled={selected.size === 0 || decideMutation.isPending}
              onClick={() =>
                decideMutation.mutate({ ids: [...selected], decision: "APPROVE" })
              }
              className="h-auto rounded-md bg-[#17191C] px-4 py-2 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
            >
              Approve
            </Button>
            <Button
              variant="outline"
              disabled={selected.size === 0 || decideMutation.isPending}
              onClick={() => {
                setActionError(null)
                setRejecting(true)
              }}
              className="h-auto rounded-md px-4 py-2 text-[12.5px] font-bold"
            >
              Reject
            </Button>
          </div>
        </div>
      ) : null}

      {actionError ? (
        <div className="mb-3">
          <PanelAlert onDismiss={() => setActionError(null)}>{actionError}</PanelAlert>
        </div>
      ) : null}

      <PanelTable
        cols="0.3fr 1.3fr 1.1fr 0.9fr 1.1fr 0.7fr 0.7fr"
        headers={["", "Why", "Employee", "Date", "In and out", "Hours", "Waiting"]}
        rows={rows}
        isLoading={approvalsQuery.isPending}
        isError={approvalsQuery.isError}
        onRetry={() => approvalsQuery.refetch()}
        // An empty queue is the good outcome here, not a gap to fill, so the
        // action reloads rather than inviting the reader to create something.
        emptyTitle={
          isPending
            ? "Nothing needs your review"
            : tab === "APPROVED"
              ? "Nothing approved yet"
              : "Nothing rejected"
        }
        emptyBody={
          isPending
            ? "Every closed day is approved. New days will show here when they close."
            : `Records you ${tab === "APPROVED" ? "approve" : "reject"} are listed here.`
        }
        emptyAction="Refresh"
        onEmptyAction={() => approvalsQuery.refetch()}
      />

      {rejecting ? (
        <DecisionDialog
          key={[...selected].join(",")}
          open
          onOpenChange={(open) => {
            if (!open) setRejecting(false)
          }}
          title={`Reject ${selected.size} record${selected.size === 1 ? "" : "s"}`}
          confirmLabel="Reject"
          pending={decideMutation.isPending}
          error={actionError}
          onConfirm={(note) =>
            decideMutation.mutate({ ids: [...selected], decision: "REJECT", note })
          }
        />
      ) : null}
    </>
  )
}
