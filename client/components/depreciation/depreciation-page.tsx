"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { ApiError } from "@/lib/api/client"
import {
  draftDepreciationRun,
  getDepreciationPreflight,
  listDepreciationRuns,
} from "@/lib/api/depreciation"
import { useSession } from "@/lib/auth/session-context"
import { formatMoney, formatMonth } from "@/lib/money"
import { DataTable } from "@/components/dashboard/data-table"
import { PageHeader } from "@/components/dashboard/page-header"
import type { TableCell } from "@/components/dashboard/types"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { RUN_STATUS_LABEL, RUN_STATUS_TONE } from "./depreciation-shared"
import { RunDetail } from "./run-detail"

/** Last month — the one a run is normally drafted for. */
function previousMonth(): { month: number; year: number } {
  const now = new Date()
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  return { month: prev.getUTCMonth() + 1, year: prev.getUTCFullYear() }
}

export function DepreciationPage() {
  const { accessToken, status } = useSession()
  const queryClient = useQueryClient()
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isAuthed = status === "authenticated" && !!accessToken
  const { month, year } = previousMonth()

  const runsQuery = useQuery({
    queryKey: ["depreciation-runs"],
    queryFn: () => listDepreciationRuns(accessToken!),
    enabled: isAuthed,
  })

  const preflightQuery = useQuery({
    queryKey: ["depreciation-preflight", year, month],
    queryFn: () => getDepreciationPreflight(accessToken!, { year, month }),
    enabled: isAuthed,
  })

  const draftMutation = useMutation({
    mutationFn: () => draftDepreciationRun(accessToken!, { month, year }),
    onSuccess: (run) => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ["depreciation-runs"] })
      setSelectedRunId(run.id)
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again."),
  })

  if (!isAuthed) return <Skeleton className="h-64 w-full" />

  if (selectedRunId) {
    return (
      <>
        <PageHeader kicker="Workspace" title="Depreciation" sub="Run detail" />
        <RunDetail runId={selectedRunId} onBack={() => setSelectedRunId(null)} />
      </>
    )
  }

  const runs = runsQuery.data ?? []
  const preflight = preflightQuery.data
  const blocked = preflight && !preflight.ok && preflight.blockers.length > 0

  const rows: TableCell[][] = runs.map((run) => [
    { text: formatMonth(run.month, run.year), weight: 600 },
    { text: run.runNo },
    { text: formatMoney(run.total ?? "0", "BDT"), weight: 600 },
    { text: String(run.chargeCount) },
    { tag: RUN_STATUS_LABEL[run.status], tone: RUN_STATUS_TONE[run.status] },
    {
      node: (
        <Button
          variant="link" className="h-auto p-0 text-caption font-semibold underline"
          onClick={() => setSelectedRunId(run.id)}
        >
          Open
        </Button>
      ),
    },
  ])

  return (
    <>
      <PageHeader
        kicker="Workspace"
        title="Depreciation"
        sub="Monthly depreciation runs that post to the ledger"
      />

      {error ? (
        <div className="mb-4 rounded-md border border-danger-line bg-danger-tint px-5 py-3.5 text-caption text-danger">
          {error}
        </div>
      ) : null}

      {blocked ? (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/5 px-5 py-3.5 text-caption">
          <p className="font-medium">{formatMonth(month, year)} cannot be posted yet.</p>
          <ul className="mt-1.5 list-inside list-disc space-y-1 text-muted-foreground">
            {preflight!.blockers.map((b) => (
              <li key={b.code}>{b.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-lead font-bold">Depreciation runs</div>
          <Button onClick={() => draftMutation.mutate()} disabled={draftMutation.isPending}>
            Draft a run for {formatMonth(month, year)}
          </Button>
        </div>

        {runsQuery.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : runsQuery.isError ? (
          <div className="rounded-md border border-line bg-white p-5.5 text-body-sm text-danger">
            Failed to load depreciation runs.{" "}
            <Button variant="link" className="h-auto p-0 font-semibold underline" onClick={() => runsQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : runs.length === 0 ? (
          <div className="rounded-md border border-line bg-white p-5.5 text-body-sm text-ink-muted">
            No depreciation runs yet. Draft one for last month to begin.
          </div>
        ) : (
          <DataTable
            title="All runs"
            cols="1.2fr 1fr 1fr 0.7fr 0.8fr 0.6fr"
            headers={["Month", "Run", "Total (BDT)", "Charges", "Status", ""]}
            rows={rows}
            action={`${runs.length} run${runs.length === 1 ? "" : "s"}`}
          />
        )}
      </div>
    </>
  )
}
