"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  deleteEarningRun,
  draftEarningRun,
  getEarningRun,
  listEarningRuns,
  postEarningRun,
  reverseEarningRun,
} from "@/lib/api/earningRun"
import { useSession } from "@/lib/auth/session-context"
import type { EarningRunStatus } from "@/lib/api/types"
import { formatMoney, formatMonth } from "@/lib/money"
import { MiniStat, PageHeader } from "@/components/dashboard/page-header"
import { ConfirmDialog, PanelAlert, PanelTable, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Tag } from "@/components/dashboard/tag"
import type { TableCell, Tone } from "@/components/dashboard/types"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

const STATUS_TONE: Record<EarningRunStatus, Tone> = { DRAFT: "neutral", POSTED: "green", REVERSED: "red" }
const STATUS_LABEL: Record<EarningRunStatus, string> = { DRAFT: "Draft", POSTED: "Posted", REVERSED: "Reversed" }

function runEarned(run: { charges: Array<{ amount: string }> }): string {
  return run.charges.reduce((s, c) => s + Number(c.amount), 0).toFixed(2)
}

/** Last month — the one a run is normally drafted for (same convention as depreciation). */
function previousMonth(): { month: number; year: number } {
  const now = new Date()
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  return { month: prev.getUTCMonth() + 1, year: prev.getUTCFullYear() }
}

export function EarningRunPage() {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { month, year } = previousMonth()

  const runs = useQuery({
    queryKey: ["earning-runs"],
    queryFn: () => listEarningRuns(accessToken!),
    enabled: Boolean(accessToken),
  })

  const draft = useMutation({
    mutationFn: () => draftEarningRun(accessToken!, { year, month }),
    onSuccess: (run) => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ["earning-runs"] })
      setSelectedRunId(run.id)
    },
    onError: (err) => setError(toMessage(err)),
  })

  if (selectedRunId) {
    return <RunDetail runId={selectedRunId} onBack={() => setSelectedRunId(null)} />
  }

  const rows: TableCell[][] = (runs.data ?? []).map((run) => [
    { text: run.runNo, weight: 600 },
    { text: formatMonth(run.month, run.year) },
    { node: <Tag label={STATUS_LABEL[run.status]} tone={STATUS_TONE[run.status]} /> },
    { text: formatMoney(runEarned(run), "BDT") },
    { text: run.postedBy ?? "—" },
    {
      node: (
        <Button variant="link" className="h-auto p-0 text-[12.5px] font-semibold underline" onClick={() => setSelectedRunId(run.id)}>
          Open
        </Button>
      ),
    },
  ])

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Accounting"
        title="Monthly earnings"
        sub="Contract revenue earned month by month on a Monthly line, drafted once and posted to the ledger."
      />

      {error ? <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>Runs</h3>
        <Button onClick={() => { setError(null); draft.mutate() }} disabled={draft.isPending}>
          {draft.isPending ? "Drafting…" : `Draft a run for ${formatMonth(month, year)}`}
        </Button>
      </div>

      <PanelTable
        cols="1fr 1.1fr 0.8fr 1fr 1fr 0.7fr"
        headers={["Run", "Month", "Status", "Earned", "Posted by", ""]}
        rows={rows}
        isLoading={runs.isPending}
        isError={runs.isError}
        onRetry={() => runs.refetch()}
        emptyTitle="No monthly earnings runs yet"
        emptyBody="Draft one for last month once a PO has a Monthly line under contract."
        emptyAction={`Draft a run for ${formatMonth(month, year)}`}
        onEmptyAction={() => { setError(null); draft.mutate() }}
      />
    </div>
  )
}

function RunDetail({ runId, onBack }: { runId: string; onBack: () => void }) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [actionError, setActionError] = useState<string | null>(null)
  const [reverseOpen, setReverseOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [reason, setReason] = useState("")

  const runQuery = useQuery({
    queryKey: ["earning-run", runId],
    queryFn: () => getEarningRun(accessToken!, runId),
    enabled: Boolean(accessToken),
  })

  function onSuccess() {
    setActionError(null)
    queryClient.invalidateQueries({ queryKey: ["earning-run", runId] })
    queryClient.invalidateQueries({ queryKey: ["earning-runs"] })
    queryClient.invalidateQueries({ queryKey: ["customer-pos"] })
  }

  const postMutation = useMutation({
    mutationFn: () => postEarningRun(accessToken!, runId),
    onSuccess,
    onError: (err) => setActionError(toMessage(err)),
  })
  const reverseMutation = useMutation({
    mutationFn: () => reverseEarningRun(accessToken!, runId, reason.trim()),
    onSuccess: () => {
      setReverseOpen(false)
      setReason("")
      onSuccess()
    },
    onError: (err) => setActionError(toMessage(err)),
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteEarningRun(accessToken!, runId),
    onSuccess: () => {
      setDeleteOpen(false)
      onSuccess()
      onBack()
    },
    onError: (err) => setActionError(toMessage(err)),
  })

  if (runQuery.isPending) return <Skeleton className="h-64 w-full" />
  if (runQuery.isError || !runQuery.data) {
    return (
      <PanelAlert>
        This run could not be loaded.{" "}
        <button type="button" className="underline" onClick={() => runQuery.refetch()}>Retry</button>
      </PanelAlert>
    )
  }

  const run = runQuery.data
  const charges = run.charges
  const nothingToPost = run.status === "DRAFT" && charges.length === 0

  const chargeRows: TableCell[][] = charges.map((c) => [
    { text: c.poLine.po.customer.legalName },
    { text: c.poLine.po.serial },
    { text: c.poLine.description },
    { text: formatMoney(c.amount, "BDT") },
  ])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" className="h-auto p-0 text-[12.5px] font-semibold" onClick={onBack}>
          ← Back to runs
        </Button>
        <Tag label={STATUS_LABEL[run.status]} tone={STATUS_TONE[run.status]} />
      </div>

      <PageHeader
        kicker="Accounting"
        title={`Monthly earnings — ${formatMonth(run.month, run.year)}`}
        sub={`${run.runNo}${run.journal?.journalNo ? ` · journal ${run.journal.journalNo}` : ""}`}
      />

      {actionError ? <PanelAlert onDismiss={() => setActionError(null)}>{actionError}</PanelAlert> : null}
      {nothingToPost ? <PanelAlert>{`${run.runNo} has nothing to post. Delete the draft instead.`}</PanelAlert> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <MiniStat label="Lines" value={String(charges.length)} sub={charges.length === 1 ? "contract line" : "contract lines"} />
        <MiniStat label="Total" value={formatMoney(runEarned(run), "BDT")} sub="for the month" />
        <MiniStat label="Status" value={STATUS_LABEL[run.status]} sub={run.postedBy ? `posted by ${run.postedBy}` : "not yet posted"} />
      </div>

      <PanelTable
        cols="1.2fr 1fr 1.4fr 1fr"
        headers={["Customer", "PO", "Line", "Amount"]}
        rows={chargeRows}
        isLoading={false}
        isError={false}
        onRetry={() => undefined}
        emptyTitle="Nothing to post"
        emptyBody="No Monthly line had a contract month falling in this run."
        onEmptyAction={() => undefined}
      />

      <div className="flex flex-wrap gap-2.5">
        {run.status === "DRAFT" ? (
          <Button onClick={() => postMutation.mutate()} disabled={postMutation.isPending || charges.length === 0}>
            {postMutation.isPending ? "Posting…" : "Post this run"}
          </Button>
        ) : null}
        {run.status === "DRAFT" ? (
          <Button variant="outline" onClick={() => setDeleteOpen(true)} disabled={deleteMutation.isPending}>
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
            <DialogDescription>
              Reversing {run.runNo} drafts a reversing journal for {formatMonth(run.month, run.year)}, which waits in
              the approval queue rather than posting straight away, and frees the month for a re-run once approved.
              The reversal needs a reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Why is this being reversed?" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReverseOpen(false)} disabled={reverseMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={() => reverseMutation.mutate()} disabled={reverseMutation.isPending || !reason.trim()}>
              {reverseMutation.isPending ? "Reversing…" : "Reverse"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this draft?"
        body={`${run.runNo} has ${charges.length} contract line${charges.length === 1 ? "" : "s"} and has not been posted. Deleting it removes the draft so the month can be drafted again.`}
        confirmLabel="Delete draft"
        pending={deleteMutation.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  )
}
