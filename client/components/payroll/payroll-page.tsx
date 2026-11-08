"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { ApiError } from "@/lib/api/client"
import { createPayrollRun, listPayrollRuns } from "@/lib/api/payroll"
import { useSession } from "@/lib/auth/session-context"
import { formatMoney, formatMonth } from "@/lib/money"
import { DataTable } from "@/components/dashboard/data-table"
import { PageHeader } from "@/components/dashboard/page-header"
import type { TableCell } from "@/components/dashboard/types"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { AdjustmentsPanel } from "@/components/payroll/adjustments-panel"
import { MyPayslips } from "@/components/payroll/my-payslips"
import {
  FINANCE_ROLES,
  HR_ROLES,
  PAYROLL_ADMIN_ROLES,
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  STAFF_ROLES,
} from "@/components/payroll/payroll-shared"
import { RunDetail } from "@/components/payroll/run-detail"

/** Last month — the one a run is normally opened for. */
function previousMonth(): { month: number; year: number } {
  const now = new Date()
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  return { month: prev.getUTCMonth() + 1, year: prev.getUTCFullYear() }
}

export function PayrollPage() {
  const { accessToken, user, status } = useSession()
  const queryClient = useQueryClient()
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isAuthed = status === "authenticated" && !!accessToken
  const isAdmin = !!user && PAYROLL_ADMIN_ROLES.includes(user.role)
  const isFinance = !!user && FINANCE_ROLES.includes(user.role)
  const isHr = !!user && HR_ROLES.includes(user.role)
  const isStaff = !!user && STAFF_ROLES.includes(user.role)

  const { month, year } = previousMonth()

  const runsQuery = useQuery({
    queryKey: ["payroll-runs"],
    queryFn: () => listPayrollRuns(accessToken!),
    enabled: isAuthed && isAdmin,
  })

  const createMutation = useMutation({
    mutationFn: () => createPayrollRun(accessToken!, { month, year }),
    onSuccess: (run) => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ["payroll-runs"] })
      setSelectedRunId(run.id)
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again."),
  })

  if (!isAuthed) return <Skeleton className="h-64 w-full" />

  // Staff see their own payslips and nothing else — the permission matrix
  // gives them no administrative payroll access at all.
  if (isStaff) {
    return (
      <>
        <PageHeader
          kicker="Workspace"
          title="Payroll"
          sub="Your payslips, earnings and deductions"
        />
        <MyPayslips />
      </>
    )
  }

  if (!isAdmin) {
    return (
      <>
        <PageHeader kicker="Workspace" title="Payroll" sub="Payslips and runs" />
        <div className="rounded-md border border-line bg-white p-5.5 text-body-sm text-ink-muted">
          You do not have access to payroll.
        </div>
      </>
    )
  }

  if (selectedRunId) {
    return (
      <>
        <PageHeader kicker="Workspace" title="Payroll" sub="Run detail" />
        <RunDetail runId={selectedRunId} onBack={() => setSelectedRunId(null)} />
      </>
    )
  }

  const runs = runsQuery.data ?? []
  const rows: TableCell[][] = runs.map((run) => [
    { text: formatMonth(run.month, run.year), weight: 600 },
    { text: String(run.payslipCount ?? 0) },
    { text: formatMoney(run.netPayableBdt ?? "0", "BDT"), weight: 600 },
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
        title="Payroll"
        sub="Monthly runs, payslips and adjustments"
      />

      {error ? (
        <div className="mb-4 rounded-md border border-danger-line bg-danger-tint px-5 py-3.5 text-caption text-danger">
          {error}
        </div>
      ) : null}

      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-lead font-bold">Payroll runs</div>
          {isFinance ? (
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              Open a run for {formatMonth(month, year)}
            </Button>
          ) : null}
        </div>

        {runsQuery.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : runsQuery.isError ? (
          <div className="rounded-md border border-line bg-white p-5.5 text-body-sm text-danger">
            Failed to load payroll runs.{" "}
            <Button variant="link" className="h-auto p-0 font-semibold underline" onClick={() => runsQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : runs.length === 0 ? (
          <div className="rounded-md border border-line bg-white p-5.5 text-body-sm text-ink-muted">
            No payroll runs yet.
            {isFinance ? " Open one for last month to begin." : ""}
          </div>
        ) : (
          <DataTable
            title="All runs"
            cols="1.2fr 0.7fr 1fr 0.8fr 0.6fr"
            headers={["Month", "Payslips", "Net payable (BDT)", "Status", ""]}
            rows={rows}
            action={`${runs.length} run${runs.length === 1 ? "" : "s"}`}
          />
        )}

        {/* HR's write surface. Finance and Super Admin see it read-only —
            they pay adjustments but do not create them. */}
        {isHr || isAdmin ? <AdjustmentsPanel month={month} year={year} /> : null}
      </div>
    </>
  )
}
