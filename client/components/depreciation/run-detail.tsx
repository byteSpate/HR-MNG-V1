"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { ApiError } from "@/lib/api/client"
import {
  deleteDepreciationRun,
  getDepreciationRun,
  postDepreciationRun,
  reverseDepreciationRun,
} from "@/lib/api/depreciation"
import type { DepreciationRunDetail } from "@/lib/api/types"
import { useSession } from "@/lib/auth/session-context"
import { formatMoney, formatMonth } from "@/lib/money"
import { DataTable } from "@/components/dashboard/data-table"
import { MiniStat, PageHeader } from "@/components/dashboard/page-header"
import { Tag } from "@/components/dashboard/tag"
import type { TableCell } from "@/components/dashboard/types"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/dashboard/record-kit"
import { fromPaisa, sumPaisa } from "@/components/accounting/accounting-shared"
import { RUN_STATUS_LABEL, RUN_STATUS_TONE } from "./depreciation-shared"

export function RunDetail({ runId, onBack }: { runId: string; onBack: () => void }) {
  const { accessToken, status } = useSession()
  const queryClient = useQueryClient()
  const [actionError, setActionError] = useState<string | null>(null)
  const [reverseOpen, setReverseOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [reason, setReason] = useState("")

  const isAuthed = status === "authenticated" && !!accessToken

  const runQuery = useQuery({
    queryKey: ["depreciation-run", runId],
    queryFn: () => getDepreciationRun(accessToken!, runId),
    enabled: isAuthed,
  })

  function onSuccess() {
    setActionError(null)
    queryClient.invalidateQueries({ queryKey: ["depreciation-run", runId] })
    queryClient.invalidateQueries({ queryKey: ["depreciation-runs"] })
    queryClient.invalidateQueries({ queryKey: ["assets"] })
  }

  function handleError(err: unknown) {
    setActionError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
  }

  const postMutation = useMutation({
    mutationFn: () => postDepreciationRun(accessToken!, runId),
    onSuccess,
    onError: handleError,
  })
  const reverseMutation = useMutation({
    mutationFn: () => reverseDepreciationRun(accessToken!, runId, reason.trim()),
    onSuccess: () => {
      setReverseOpen(false)
      setReason("")
      onSuccess()
    },
    onError: handleError,
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteDepreciationRun(accessToken!, runId),
    onSuccess: () => {
      setDeleteOpen(false)
      onSuccess()
      onBack()
    },
    onError: handleError,
  })

  if (!isAuthed) return <Skeleton className="h-64 w-full" />

  if (runQuery.isPending) return <Skeleton className="h-64 w-full" />
  if (runQuery.isError || !runQuery.data) {
    return (
      <div className="rounded-md border border-line bg-white p-5.5 text-body-sm text-danger">
        Failed to load this run.{" "}
        <Button variant="link" className="h-auto p-0 font-semibold underline" onClick={() => runQuery.refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  const run = runQuery.data

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" className="h-auto p-0 text-caption font-semibold" onClick={onBack}>
          ← Back to runs
        </Button>
        <Tag label={RUN_STATUS_LABEL[run.status]} tone={RUN_STATUS_TONE[run.status]} />
      </div>

      <PageHeader
        kicker="Workspace"
        title={`Depreciation — ${formatMonth(run.month, run.year)}`}
        sub={`${run.runNo}${run.journal?.journalNo ? ` · journal ${run.journal.journalNo}` : ""}`}
      />

      {actionError ? (
        <div className="mb-4 rounded-md border border-danger-line bg-danger-tint px-5 py-3.5 text-caption text-danger">
          {actionError}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <MiniStat label="Charges" value={String(run.charges.length)} sub={run.charges.length === 1 ? "asset" : "assets"} />
        <MiniStat
          label="Total"
          value={formatMoney(fromPaisa(sumPaisa(run.charges.map((c) => c.amount))), "BDT")}
          sub="for the month"
        />
        <MiniStat
          label="Status"
          value={RUN_STATUS_LABEL[run.status]}
          sub={run.postedBy ? `posted by ${run.postedBy}` : "not yet posted"}
        />
      </div>

      <RunChargesTable run={run} />

      <div className="flex flex-wrap gap-2.5">
        {run.status === "DRAFT" ? (
          <Button onClick={() => postMutation.mutate()} disabled={postMutation.isPending}>
            {postMutation.isPending ? "Posting…" : "Post this run"}
          </Button>
        ) : null}
        {run.status === "DRAFT" ? (
          <Button
            variant="outline"
            onClick={() => setDeleteOpen(true)}
            disabled={deleteMutation.isPending}
          >
            Delete draft
          </Button>
        ) : null}
        {run.status === "POSTED" ? (
          <Button variant="outline" onClick={() => setReverseOpen(true)}>
            Reverse this run
          </Button>
        ) : null}
      </div>

      <Dialog open={reverseOpen} onOpenChange={setReverseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse this run</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-caption text-ink-muted">
              Reversing {run.runNo} reverses its journal and frees {formatMonth(run.month, run.year)} for a
              re-run. The reversal needs a reason.
            </p>
            <Input
              placeholder="Why is this being reversed?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReverseOpen(false)} disabled={reverseMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => reverseMutation.mutate()}
              disabled={reverseMutation.isPending || !reason.trim()}
            >
              {reverseMutation.isPending ? "Reversing…" : "Reverse"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this draft?"
        body={
          <>
            {run.runNo} has {run.charges.length} charge{run.charges.length === 1 ? "" : "s"} and has not been
            posted. Deleting it removes the draft and its charges so the month can be drafted again.
          </>
        }
        confirmLabel="Delete draft"
        pending={deleteMutation.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </>
  )
}

function RunChargesTable({ run }: { run: DepreciationRunDetail }) {
  const rows: TableCell[][] = run.charges.map((c) => [
    { text: c.asset?.assetTag ?? c.assetId, weight: 600 },
    { text: c.asset?.name ?? "" },
    { text: c.asset?.categoryName ?? "" },
    { text: formatMoney(c.openingBookValue, "BDT") },
    { text: `${c.rate}%` },
    { text: String(c.months) },
    { text: formatMoney(c.amount, "BDT"), weight: 600 },
  ])

  return (
    <div className="mt-6">
      <DataTable
        title={run.status === "DRAFT" ? "Preview — every charge this run will post" : "Charges posted"}
        cols="1fr 1.4fr 1fr 1fr 0.7fr 0.6fr 1fr"
        headers={["Asset", "Name", "Class", "Opening value", "Rate", "Months", "Charge"]}
        rows={rows}
        action={`${run.charges.length} charge${run.charges.length === 1 ? "" : "s"}`}
      />
    </div>
  )
}
