"use client"

import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"

import { ApiError } from "@/lib/api/client"
import { downloadPayslipPdf, getEmployeePayslips } from "@/lib/api/payroll"
import { useSession } from "@/lib/auth/session-context"
import type { Payslip, PayrollStatus } from "@/lib/api/types"
import { formatMoney, formatMonth } from "@/lib/money"
import { downloadBlob } from "@/components/payroll/payroll-shared"
import { PayslipDetail } from "@/components/payroll/payslip-detail"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { dialogWidthClass } from "@/components/ds/dialog-sizes"
import { cx } from "@/components/ds/classes"

/**
 * A run only becomes real pay at APPROVED. Before that the figures are a
 * working draft that Finance can still reprocess.
 */
const isFinal = (status: PayrollStatus | undefined) =>
  status === "APPROVED" || status === "DISBURSED"

/**
 * An employee's payslip history, on their record.
 *
 * `getEmployeePayslips` has existed on both sides since payroll shipped with
 * no caller anywhere, so an employee could read their own payslips and nobody
 * else could read them at all. Answering "what did we actually pay her in
 * March" meant opening the March run and searching it, which does not work
 * once the question spans months.
 *
 * The draft marking is not decoration. `visibleRunFilter` returns `{}` for
 * HR, Finance and Super Admin, so unlike `/payslips/me` this list includes
 * payslips from runs still in DRAFT or SUBMITTED. Printing an unapproved
 * figure next to a disbursed one with nothing between them invites someone to
 * quote a number that has not been paid and may still change.
 */
export function PayslipsCard({ employeeId }: { employeeId: string }) {
  const { accessToken, status: sessionStatus } = useSession()
  const [selected, setSelected] = useState<Payslip | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const payslipsQuery = useQuery({
    queryKey: ["payslips", employeeId],
    queryFn: () => getEmployeePayslips(accessToken!, employeeId),
    enabled: sessionStatus === "authenticated" && !!accessToken,
  })

  const downloadMutation = useMutation({
    mutationFn: async (payslip: Payslip) => {
      const blob = await downloadPayslipPdf(accessToken!, payslip.id)
      downloadBlob(blob, `${payslip.payslipNo}.pdf`)
    },
    onSuccess: () => setDownloadError(null),
    onError: (err) =>
      setDownloadError(err instanceof ApiError ? err.message : "Could not download that payslip."),
  })

  if (payslipsQuery.isPending) {
    return <Skeleton className="h-40 w-full" />
  }

  if (payslipsQuery.isError) {
    return (
      <div className="rounded-md border border-line bg-white px-5.5 py-5 text-body-sm text-danger">
        Could not load this employee&rsquo;s payslips.{" "}
        <Button
          variant="link"
          className="h-auto p-0 font-semibold underline"
          onClick={() => payslipsQuery.refetch()}
        >
          Retry
        </Button>
      </div>
    )
  }

  const payslips = payslipsQuery.data ?? []
  const drafts = payslips.filter((p) => !isFinal(p.payrollRun?.status)).length

  return (
    <div className="flex flex-col rounded-md border border-line bg-white px-5.5 py-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div className="text-lead font-bold">Payslips</div>
        {payslips.length > 0 ? (
          <div className="text-caption text-ink-muted">
            {payslips.length} month{payslips.length === 1 ? "" : "s"}
            {drafts > 0 ? `, ${drafts} not approved` : ""}
          </div>
        ) : null}
      </div>

      {downloadError ? (
        <div className="mb-3 rounded-md border border-danger-line bg-danger-tint px-3.5 py-2.5 text-caption text-danger">
          {downloadError}
        </div>
      ) : null}

      {payslips.length === 0 ? (
        <p className="text-body-sm text-ink-muted">
          No payslips yet. One appears here for every payroll run that covers this employee, from
          the moment it is processed.
        </p>
      ) : (
        // Capped rather than paged: a long-serving employee has dozens of
        // these, and the card sits in a grid with the field cards.
        <ul className="-my-1 max-h-76 divide-y divide-surface-sunken overflow-y-auto">
          {payslips.map((payslip) => {
            const provisional = !isFinal(payslip.payrollRun?.status)
            return (
              <li key={payslip.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-body-sm font-semibold">
                    {payslip.payrollRun
                      ? formatMonth(payslip.payrollRun.month, payslip.payrollRun.year)
                      : payslip.payslipNo}
                  </div>
                  <div className="text-caption text-ink-muted">
                    {formatMoney(payslip.netPayable, payslip.currency)}
                    {provisional ? (
                      // The run's own status word, not a generic "draft": the
                      // reader may need to go and approve the thing.
                      <span className="ml-1.5 font-semibold text-warning">
                        {payslip.payrollRun?.status === "SUBMITTED"
                          ? "awaiting approval"
                          : "draft, not approved"}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="link"
                    className="h-auto p-0 text-caption font-semibold underline"
                    onClick={() => setSelected(payslip)}
                  >
                    View
                  </Button>
                  <Button
                    variant="link"
                    className="h-auto p-0 text-caption font-semibold underline disabled:opacity-50"
                    disabled={downloadMutation.isPending}
                    onClick={() => downloadMutation.mutate(payslip)}
                  >
                    PDF
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* A dialog rather than swapping the card's contents, which is what the
          employee's own page does: there the table owns the full width, while
          this card is one cell of a grid and the breakdown does not fit in it. */}
      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className={cx(dialogWidthClass("lg"), "max-h-[86dvh] overflow-y-auto")}>
          <DialogHeader>
            <DialogTitle>Payslip</DialogTitle>
          </DialogHeader>
          {selected ? <PayslipDetail payslip={selected} onClose={() => setSelected(null)} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
