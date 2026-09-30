"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { ApiError } from "@/lib/api/client"
import { listRecoveries, recoverFromPayroll, waiveRecovery } from "@/lib/api/assets"
import { getPayrollSettings } from "@/lib/api/payroll"
import type { AssetRecovery } from "@/lib/api/types"
import { useSession } from "@/lib/auth/session-context"
import { formatMoney } from "@/lib/money"
import { PanelNotice, PanelTable } from "@/components/dashboard/record-kit"
import type { TableCell } from "@/components/dashboard/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  RECOVERY_KIND_LABEL,
  RECOVERY_STATUS_LABEL,
  RECOVERY_STATUS_TONE,
} from "@/components/asset/asset-shared"
import { CreateRecoveryDialog } from "@/components/asset/create-recovery-dialog"

const cols = "1.1fr 1.3fr 0.9fr 1fr 1fr 0.9fr 1.2fr"

export function RecoveriesTab({ onChanged }: { onChanged?: () => void }) {
  const { accessToken, status } = useSession()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [waiving, setWaiving] = useState<AssetRecovery | null>(null)
  const [waiverReason, setWaiverReason] = useState("")
  const [error, setError] = useState<string | null>(null)

  const isAuthed = status === "authenticated" && !!accessToken

  const recoveriesQuery = useQuery({
    queryKey: ["asset-recoveries"],
    queryFn: () => listRecoveries(accessToken!),
    enabled: isAuthed,
  })

  // Whether the company takes lost or damaged assets from salary. Some roles
  // cannot read the setting, and then the button stays, because the server
  // gives the real answer and says why when it refuses.
  const settingsQuery = useQuery({
    queryKey: ["payroll-settings"],
    queryFn: () => getPayrollSettings(accessToken!),
    enabled: isAuthed,
  })
  const salaryOff = settingsQuery.data?.recoverAssetsFromSalary === false

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["asset-recoveries"] })
    onChanged?.()
  }

  function handleError(err: unknown) {
    setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
  }

  const waiveMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      waiveRecovery(accessToken!, id, reason),
    onSuccess: () => {
      setError(null)
      setWaiving(null)
      setWaiverReason("")
      invalidate()
    },
    onError: handleError,
  })

  const collectMutation = useMutation({
    mutationFn: (id: string) => recoverFromPayroll(accessToken!, id),
    onSuccess: () => {
      setError(null)
      invalidate()
    },
    onError: handleError,
  })

  if (!isAuthed) return <Skeleton className="h-40 w-full" />

  const recoveries = recoveriesQuery.data ?? []

  const rows: TableCell[][] = recoveries.map((r) => [
    { text: r.asset?.assetTag ?? r.assetId, weight: 600 },
    { text: r.asset?.name ?? "" },
    { text: RECOVERY_KIND_LABEL[r.kind] },
    {
      node: (
        <Badge className={RECOVERY_STATUS_TONE[r.status]}>{RECOVERY_STATUS_LABEL[r.status]}</Badge>
      ),
    },
    { text: formatMoney(r.amount, r.currency), weight: 600 },
    {
      node: (
        <span className="line-clamp-2 text-[12px] text-[#5F6B7C]" title={r.reason}>
          {r.reason}
        </span>
      ),
    },
    {
      node: (
        <div className="flex justify-end gap-1.5 whitespace-nowrap">
          {r.status === "PENDING" ? (
            <>
              {salaryOff ? null : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={collectMutation.isPending}
                  onClick={() => collectMutation.mutate(r.id)}
                >
                  Recover from payroll
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setWaiving(r)}
              >
                Waive
              </Button>
            </>
          ) : null}
          {r.status === "RECOVERED" ? (
            <span className="text-[11.5px] text-[#5F6B7C]">
              {r.adjustment?.payslip?.payslipNo ?? r.settlement?.settlementNo ?? "Collected"}
            </span>
          ) : null}
        </div>
      ),
    },
  ])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[13px] text-[#5F6B7C]">
          Debts raised against employees for assets not returned, damaged or lost.
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          Raise a recovery
        </Button>
      </div>

      {salaryOff ? (
        <PanelNotice>
          Money for assets is not taken from salary. This is set in Settings, then Payroll. If the
          employee does not need to pay, use Waive.
        </PanelNotice>
      ) : null}

      {error ? (
        <div className="rounded-md border border-[#F0D9D9] bg-[#FDF6F6] px-4 py-3 text-[12.5px] text-[#B03A3A]">
          {error}
        </div>
      ) : null}

      <PanelTable
        cols={cols}
        headers={["Asset", "Name", "Kind", "Status", "Amount", "Reason", ""]}
        rows={rows}
        isLoading={recoveriesQuery.isPending}
        isError={recoveriesQuery.isError}
        onRetry={() => recoveriesQuery.refetch()}
        emptyTitle="No recoveries yet"
        emptyBody="A recovery is raised when an asset is marked lost or comes back damaged, or by hand here."
        emptyAction="Raise a recovery"
        onEmptyAction={() => setCreateOpen(true)}
      />

      <CreateRecoveryDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={invalidate}
      />

      <WaiveDialog
        recovery={waiving}
        reason={waiverReason}
        setReason={setWaiverReason}
        pending={waiveMutation.isPending}
        error={error}
        onClose={() => {
          setWaiving(null)
          setWaiverReason("")
        }}
        onConfirm={() => waiving && waiveMutation.mutate({ id: waiving.id, reason: waiverReason })}
      />
    </div>
  )
}

function WaiveDialog({
  recovery,
  reason,
  setReason,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  recovery: AssetRecovery | null
  reason: string
  setReason: (v: string) => void
  pending: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={!!recovery} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Waive this recovery?</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-[12.5px] leading-relaxed text-[#5F6B7C]">
            Waiving keeps the row and records who decided and why. &ldquo;We chose not to charge
            her&rdquo; is precisely what an auditor asks about — a deleted row cannot answer. The
            amount {recovery ? formatMoney(recovery.amount, recovery.currency) : ""} will not be
            collected.
          </p>
          <div>
            <Label htmlFor="waiver-reason" className="mb-1.5 block text-xs font-bold">
              Why is this being waived?
            </Label>
            <Textarea
              id="waiver-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Company fault, insurance covered it, damage not theirs…"
            />
          </div>
          {error ? <p className="text-[13px] font-semibold text-[#B03A3A]">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pending || reason.trim().length === 0}
              onClick={onConfirm}
              className="bg-[#17191C] text-white hover:bg-[#0E1012]"
            >
              {pending ? "Waiving…" : "Waive recovery"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
