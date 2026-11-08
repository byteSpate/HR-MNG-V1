"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { ApiError } from "@/lib/api/client"
import { createAdjustment, deleteAdjustment, listAdjustments } from "@/lib/api/payroll"
import { listEmployees } from "@/lib/api/employees"
import { useSession } from "@/lib/auth/session-context"
import type { AdjustmentInput } from "@/lib/api/types"
import { formatMoney, formatMonth } from "@/lib/money"
import { DataTable } from "@/components/dashboard/data-table"
import type { TableCell } from "@/components/dashboard/types"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { AdjustmentDialog } from "@/components/payroll/adjustment-dialog"
import { HR_ROLES } from "@/components/payroll/payroll-shared"

export function AdjustmentsPanel({ month, year }: { month: number; year: number }) {
  const { accessToken, user } = useSession()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canWrite = !!user && HR_ROLES.includes(user.role)

  const adjustmentsQuery = useQuery({
    queryKey: ["adjustments", year, month],
    queryFn: () => listAdjustments(accessToken!, { month, year }),
    enabled: !!accessToken,
  })

  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: () => listEmployees(accessToken!),
    enabled: !!accessToken && canWrite && open,
  })

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["adjustments", year, month] })
    queryClient.invalidateQueries({ queryKey: ["payroll-runs"] })
  }

  const createMutation = useMutation({
    mutationFn: (input: AdjustmentInput) => createAdjustment(accessToken!, input),
    onSuccess: () => {
      setError(null)
      setOpen(false)
      invalidate()
    },
    // A locked month 409s here; the server's own message explains why, which
    // a generic fallback would hide.
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again."),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAdjustment(accessToken!, id),
    onSuccess: () => {
      setError(null)
      invalidate()
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again."),
  })

  if (adjustmentsQuery.isPending) return <Skeleton className="h-40 w-full" />

  const adjustments = adjustmentsQuery.data ?? []

  const rows: TableCell[][] = adjustments.map((a) => [
    { text: a.employee?.fullName ?? "—", sub: a.employee?.employeeCode, weight: 600 },
    { text: a.label, sub: a.reason },
    {
      text: `${a.kind === "EARNING" ? "+" : "−"}${formatMoney(a.amount, a.currency)}`,
      weight: 600,
    },
    a.payslipId
      ? { tag: "Paid", tone: "green" }
      : canWrite
        ? {
            node: (
              <Button
                variant="link" className="h-auto p-0 text-caption font-semibold underline disabled:opacity-50"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(a.id)}
              >
                Remove
              </Button>
            ),
          }
        : { tag: "Pending", tone: "yellow" },
  ])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lead font-bold">Adjustments · {formatMonth(month, year)}</div>
          <div className="mt-0.5 text-caption text-ink-muted">
            Bonuses, arrears and one-off recoveries. HR owns these; Finance pays them.
          </div>
        </div>
        {canWrite ? <Button onClick={() => setOpen(true)}>Add adjustment</Button> : null}
      </div>

      {error ? (
        <div className="rounded-md border border-danger-line bg-danger-tint px-5 py-3.5 text-caption text-danger">
          {error}
        </div>
      ) : null}

      {adjustments.length === 0 ? (
        <div className="rounded-md border border-line bg-white p-5.5 text-body-sm text-ink-muted">
          No adjustments for this month.
        </div>
      ) : (
        <DataTable
          title="This month"
          cols="1.4fr 1.6fr 1fr 0.8fr"
          headers={["Employee", "Adjustment", "Amount", ""]}
          rows={rows}
          action={`${adjustments.length} line${adjustments.length === 1 ? "" : "s"}`}
        />
      )}

      {open ? (
        <AdjustmentDialog
          key={`adj-${year}-${month}`}
          open={open}
          onOpenChange={setOpen}
          // HR (the only role that opens this dialog) always gets the
          // `employment` group; filtering rather than fabricating a code
          // for the rare row that somehow lacks one.
          employees={(employeesQuery.data ?? []).flatMap((e) =>
            e.employment
              ? [{ id: e.id, fullName: e.work.fullName, employeeCode: e.employment.employeeCode }]
              : []
          )}
          month={month}
          year={year}
          pending={createMutation.isPending}
          error={error}
          onSubmit={(input) => createMutation.mutate(input)}
        />
      ) : null}
    </div>
  )
}
