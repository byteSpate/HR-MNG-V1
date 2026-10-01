"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { ApiError } from "@/lib/api/client"
import {
  approvePayrollRun,
  disbursePayrollRun,
  downloadBankFile,
  emailPayslips,
  getBankFileSummary,
  getEmailStatus,
  getPayrollRun,
  processPayrollRun,
  rejectPayrollRun,
  submitPayrollRun,
} from "@/lib/api/payroll"
import { useSession } from "@/lib/auth/session-context"
import type { Currency, PreflightBlocker } from "@/lib/api/types"
import { formatMoney, formatMonth, formatRate, isNegativeMoney } from "@/lib/money"
import { DataTable } from "@/components/dashboard/data-table"
import { MiniStat } from "@/components/dashboard/page-header"
import { Tag } from "@/components/dashboard/tag"
import type { TableCell } from "@/components/dashboard/types"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { DecisionDialog } from "@/components/leave/decision-dialog"
import { PreflightPanel } from "@/components/payroll/preflight-panel"
import {
  downloadBlob,
  FINANCE_ROLES,
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
} from "@/components/payroll/payroll-shared"

export function RunDetail({ runId, onBack }: { runId: string; onBack: () => void }) {
  const { accessToken, user } = useSession()
  const queryClient = useQueryClient()
  const [actionError, setActionError] = useState<string | null>(null)
  const [blockers, setBlockers] = useState<PreflightBlocker[] | null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [emailStarted, setEmailStarted] = useState(false)

  const isFinance = !!user && FINANCE_ROLES.includes(user.role)
  const isSuperAdmin = user?.role === "SUPER_ADMIN"

  const runQuery = useQuery({
    queryKey: ["payroll-run", runId],
    queryFn: () => getPayrollRun(accessToken!, runId),
    enabled: !!accessToken,
  })

  const run = runQuery.data

  const summaryQuery = useQuery({
    queryKey: ["bank-file-summary", runId],
    queryFn: () => getBankFileSummary(accessToken!, runId),
    enabled: !!accessToken && isFinance && (run?.status === "APPROVED" || run?.status === "DISBURSED"),
  })

  const emailStatusQuery = useQuery({
    queryKey: ["email-status", runId],
    queryFn: () => getEmailStatus(accessToken!, runId),
    enabled: !!accessToken && emailStarted,
    // Polls at 2s only while a send is in flight, then stops on its own. The
    // query stays enabled afterwards on purpose, so the final "Emailed 5 of
    // 5" remains on screen instead of vanishing the moment it completes.
    refetchInterval: (query) => (query.state.data?.inProgress ? 2000 : false),
  })

  function handleError(err: unknown) {
    if (err instanceof ApiError) {
      setActionError(err.message)
      // The preflight's 409 carries its blockers; rendering them is the whole
      // point of naming who is blocking.
      const list = err.details?.blockers
      setBlockers(Array.isArray(list) ? (list as PreflightBlocker[]) : null)
      return
    }
    setActionError("Something went wrong. Please try again.")
    setBlockers(null)
  }

  function onSuccess() {
    setActionError(null)
    setBlockers(null)
    queryClient.invalidateQueries({ queryKey: ["payroll-run", runId] })
    queryClient.invalidateQueries({ queryKey: ["payroll-runs"] })
    queryClient.invalidateQueries({ queryKey: ["expenses"] })
    queryClient.invalidateQueries({ queryKey: ["bank-file-summary", runId] })
  }

  // No optimistic mutations anywhere here. Telling Finance a run was approved
  // when the request failed is not recoverable by a refetch.
  const processMutation = useMutation({
    mutationFn: () => processPayrollRun(accessToken!, runId),
    onSuccess,
    onError: handleError,
  })
  const submitMutation = useMutation({
    mutationFn: () => submitPayrollRun(accessToken!, runId),
    onSuccess,
    onError: handleError,
  })
  const approveMutation = useMutation({
    mutationFn: () => approvePayrollRun(accessToken!, runId),
    onSuccess,
    onError: handleError,
  })
  const rejectMutation = useMutation({
    mutationFn: (note: string) => rejectPayrollRun(accessToken!, runId, note),
    onSuccess: () => {
      setRejectOpen(false)
      onSuccess()
    },
    onError: handleError,
  })
  const disburseMutation = useMutation({
    mutationFn: () => disbursePayrollRun(accessToken!, runId),
    onSuccess,
    onError: handleError,
  })
  const emailMutation = useMutation({
    mutationFn: () => emailPayslips(accessToken!, runId),
    onSuccess: () => {
      setActionError(null)
      setEmailStarted(true)
    },
    onError: handleError,
  })

  const bankFileMutation = useMutation({
    mutationFn: async (currency: Currency) => {
      const { blob, manifest } = await downloadBankFile(accessToken!, runId, currency)
      downloadBlob(
        blob,
        `payroll-${run!.year}-${String(run!.month).padStart(2, "0")}-${currency}.csv`
      )
      return manifest
    },
    onSuccess: () => setActionError(null),
    onError: handleError,
  })

  if (runQuery.isPending) {
    return <Skeleton className="h-64 w-full" />
  }
  if (runQuery.isError || !run) {
    return (
      <div className="rounded-md border border-[#E4E9EF] bg-white p-5.5 text-[13px] text-[#B03A3A]">
        Failed to load this run.{" "}
        <Button variant="link" className="h-auto p-0 font-semibold underline" onClick={() => runQuery.refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  const payslips = run.payslips ?? []
  const anyPending =
    processMutation.isPending ||
    submitMutation.isPending ||
    approveMutation.isPending ||
    disburseMutation.isPending ||
    rejectMutation.isPending

  // Only the actions this role and status permit are rendered at all; the
  // rest are absent rather than disabled and mysterious.
  const canProcess = isFinance && run.status === "DRAFT"
  const canSubmit = isFinance && run.status === "DRAFT" && !!run.processedAt
  const canApprove = isSuperAdmin && run.status === "SUBMITTED"
  const canDisburse = isFinance && run.status === "APPROVED"
  const canEmail = isFinance && (run.status === "APPROVED" || run.status === "DISBURSED")

  const rows: TableCell[][] = payslips.map((p) => [
    { text: p.employee?.fullName ?? "—", sub: p.employee?.employeeCode, weight: 600 },
    { text: formatMoney(p.grossPay, p.currency) },
    { text: `−${formatMoney(p.totalDeductions, p.currency)}` },
    {
      text: formatMoney(p.netPayable, p.currency),
      weight: 600,
      sub: p.currency === "BDT" ? undefined : formatMoney(p.netPayableBdt, "BDT"),
    },
    { text: p.lopDays },
  ])

  return (
    <div className="space-y-5">
      <Button variant="link" className="h-auto p-0 text-[12.5px] font-semibold text-[#7A8698] underline" onClick={onBack}>
        ← All runs
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-heading text-[22px] font-bold tracking-tight">
            {formatMonth(run.month, run.year)}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <Tag label={RUN_STATUS_LABEL[run.status]} tone={RUN_STATUS_TONE[run.status]} />
            {/* The frozen rate appears once for the run, not per row. */}
            {run.fxRateToBdt ? (
              <span className="text-[12px] text-[#7A8698]">
                Rate frozen at 1 USD = {formatRate(run.fxRateToBdt)} BDT
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {canProcess ? (
            <Button onClick={() => processMutation.mutate()} disabled={anyPending}>
              {run.processedAt ? "Reprocess" : "Process"}
            </Button>
          ) : null}
          {canSubmit ? (
            <Button onClick={() => submitMutation.mutate()} disabled={anyPending}>
              Submit for approval
            </Button>
          ) : null}
          {canApprove ? (
            <>
              <Button
                onClick={() => approveMutation.mutate()}
                disabled={anyPending}
              >
                Approve
              </Button>
              <Button variant="outline" onClick={() => setRejectOpen(true)} disabled={anyPending}>
                Reject
              </Button>
            </>
          ) : null}
          {canDisburse ? (
            <Button onClick={() => disburseMutation.mutate()} disabled={anyPending}>
              Disburse
            </Button>
          ) : null}
        </div>
      </div>

      {run.rejectionNote ? (
        <div className="rounded-md border border-[#F0D9D9] bg-[#FDF6F6] px-5 py-3.5 text-[12.5px] text-[#B03A3A]">
          Returned to draft: {run.rejectionNote}
        </div>
      ) : null}

      {actionError ? (
        <div className="rounded-md border border-[#F0D9D9] bg-[#FDF6F6] px-5 py-3.5 text-[12.5px] text-[#B03A3A]">
          {actionError}
        </div>
      ) : null}

      {blockers ? (
        <PreflightPanel report={{ month: run.month, year: run.year, ok: false, blockers }} />
      ) : run.preflight && run.status === "DRAFT" ? (
        <PreflightPanel report={run.preflight} />
      ) : null}

      {run.accounting && (!run.accounting.accrual.ok || !run.accounting.payment.ok) ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">This run cannot be posted to the ledger yet</p>
          {!run.accounting.accrual.ok ? <p className="mt-1">Approving accrues to <strong>{run.accounting.accrual.label}</strong>, which is {run.accounting.accrual.status === "MISSING" ? "not covered by any financial year" : run.accounting.accrual.status.toLowerCase()}.</p> : null}
          {!run.accounting.payment.ok ? <p className="mt-1">Disbursing posts to <strong>{run.accounting.payment.label}</strong>, which is {run.accounting.payment.status === "MISSING" ? "not covered by any financial year" : run.accounting.payment.status.toLowerCase()}.</p> : null}
        </div>
      ) : null}

      {payslips.length > 0 ? (
        <>
          {/* Run totals are BDT only — the one denomination that can be summed
              across currencies. */}
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <MiniStat label="Payslips" value={String(run.payslipCount ?? payslips.length)} sub="This run" />
            <MiniStat
              label="Gross (BDT)"
              value={formatMoney(run.grossPayBdt ?? "0", "BDT")}
              sub="All currencies"
            />
            <MiniStat
              label="Deductions (BDT)"
              value={formatMoney(run.totalDeductionsBdt ?? "0", "BDT")}
              sub="All currencies"
            />
            <MiniStat
              label="Net payable (BDT)"
              value={formatMoney(run.netPayableBdt ?? "0", "BDT")}
              sub="What the bank files pay"
            />
          </div>

          <DataTable
            title="Payslips"
            cols="1.4fr 1fr 1fr 1fr 0.6fr"
            headers={["Employee", "Gross", "Deductions", "Net payable", "LOP"]}
            rows={rows}
            action={`${payslips.length} employee${payslips.length === 1 ? "" : "s"}`}
          />
        </>
      ) : null}

      {payslips.some((p) => isNegativeMoney(p.netPay)) ? (
        <div className="rounded-md border border-[#F0D9D9] bg-[#FDF6F6] px-5 py-3.5 text-[12.5px] text-[#B03A3A]">
          One or more payslips compute a negative net pay. HR resolves this with an adjustment.
        </div>
      ) : null}

      {canEmail ? (
        <div className="rounded-md border border-[#E4E9EF] bg-white px-5.5 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[15px] font-bold">Bank files and payslips</div>
              <div className="mt-0.5 text-[12.5px] text-[#7A8698]">
                One file per currency. BEFTN is domestic and BDT-only.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => bankFileMutation.mutate("BDT")}
                disabled={bankFileMutation.isPending}
              >
                Download BDT file
              </Button>
              <Button
                variant="outline"
                onClick={() => bankFileMutation.mutate("USD")}
                disabled={bankFileMutation.isPending}
              >
                Download USD file
              </Button>
              <Button onClick={() => emailMutation.mutate()} disabled={emailMutation.isPending}>
                Email payslips
              </Button>
            </div>
          </div>

          {/* The row-count assertion on screen, so "did everyone get into a
              file?" is answered here rather than by inspecting a CSV. */}
          {summaryQuery.data ? (
            <div
              className={`mt-4 rounded-md border px-4 py-3 text-[12.5px] ${
                summaryQuery.data.complete
                  ? "border-[#CDE7D4] bg-[#F3FAF5] text-[#2F6B42]"
                  : "border-[#F0D9D9] bg-[#FDF6F6] text-[#B03A3A]"
              }`}
            >
              {summaryQuery.data.complete
                ? `All ${summaryQuery.data.payslipCount} payslips are covered across ${summaryQuery.data.currencies.length} file(s).`
                : `Only ${summaryQuery.data.totalRows} of ${summaryQuery.data.payslipCount} payslips are covered — somebody would not be paid.`}
              <ul className="mt-1.5 space-y-0.5">
                {summaryQuery.data.currencies.map((c) => (
                  <li key={c.currency}>
                    {c.currency}: {c.rows} row{c.rows === 1 ? "" : "s"} ·{" "}
                    {formatMoney(c.totalNative, c.currency)} ({formatMoney(c.totalBdt, "BDT")})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {emailStatusQuery.data ? (
            <div className="mt-3 text-[12.5px] text-[#7A8698]">
              Emailed {emailStatusQuery.data.sent} of {emailStatusQuery.data.total}
              {emailStatusQuery.data.failed > 0 ? ` · ${emailStatusQuery.data.failed} failed` : ""}
              {emailStatusQuery.data.inProgress ? " · sending…" : ""}
            </div>
          ) : null}
        </div>
      ) : null}

      {rejectOpen ? (
        <DecisionDialog
          key={`reject-${runId}`}
          open={rejectOpen}
          onOpenChange={setRejectOpen}
          title="Return this run to draft"
          confirmLabel="Reject"
          pending={rejectMutation.isPending}
          error={rejectMutation.isError ? actionError : null}
          onConfirm={(note) => rejectMutation.mutate(note)}
        />
      ) : null}
    </div>
  )
}
