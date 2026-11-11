"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"

import { ApiError } from "@/lib/api/client"
import { createRecovery, getAsset, getAssetValueReport, listAssets } from "@/lib/api/assets"
import { listEmployees } from "@/lib/api/employees"
import type { EmployeeView } from "@/lib/api/types"
import { useSession } from "@/lib/auth/session-context"
import { formatMoney } from "@/lib/money"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { formatAssetDate } from "@/components/asset/asset-shared"

/**
 * Decision 2: the amount is typed by a person, never computed. The dialog
 * shows purchase cost, purchase date and book value today as read-only
 * context — never as a prefill. Depreciated book value, replacement cost and
 * original cost are three defensible answers and the system cannot see which
 * one applies.
 */
export function CreateRecoveryDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const { accessToken, status } = useSession()
  const isAuthed = status === "authenticated" && !!accessToken

  const [assetId, setAssetId] = useState("")
  const [employeeId, setEmployeeId] = useState("")
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)

  const assetsQuery = useQuery({
    queryKey: ["assets", "all"],
    queryFn: () => listAssets(accessToken!, {}),
    enabled: isAuthed && open,
  })

  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: () => listEmployees(accessToken!),
    enabled: isAuthed && open,
  })

  // Base UI's Select shows the raw value on the closed trigger without
  // `items` — a uuid where the open list read the asset tag or the name.
  const assetItems = useMemo(
    () =>
      Object.fromEntries((assetsQuery.data ?? []).map((a) => [a.id, `${a.assetTag} · ${a.name}`])),
    [assetsQuery.data]
  )
  const employeeItems = useMemo(
    () =>
      Object.fromEntries(
        (employeesQuery.data ?? []).map((e: EmployeeView) => [
          e.id,
          `${e.work.fullName} · ${e.employment?.employeeCode ?? ""}`,
        ])
      ),
    [employeesQuery.data]
  )

  // Read-only context for the chosen asset. 4a's book-value report exists in
  // this build, so the "book value today" row is present.
  const assetQuery = useQuery({
    queryKey: ["asset", assetId],
    queryFn: () => getAsset(accessToken!, assetId),
    enabled: isAuthed && open && !!assetId,
  })
  const valueQuery = useQuery({
    queryKey: ["asset-value"],
    queryFn: () => getAssetValueReport(accessToken!, {}),
    enabled: isAuthed && open && !!assetId,
  })
  const bookValue = valueQuery.data?.rows.find((r) => r.assetId === assetId)

  const createMutation = useMutation({
    mutationFn: () =>
      createRecovery(accessToken!, {
        assetId,
        employeeId,
        amount: amount.trim(),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setError(null)
      setAssetId("")
      setEmployeeId("")
      setAmount("")
      setReason("")
      onOpenChange(false)
      onSuccess()
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again."),
  })

  const asset = assetQuery.data
  const valid = assetId && employeeId && amount.trim() !== "" && reason.trim() !== ""

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Raise an asset recovery</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {assetsQuery.isPending || employeesQuery.isPending ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="mb-1.5 block text-xs font-bold">Asset</Label>
                  <Select items={assetItems} value={assetId} onValueChange={(v) => v && setAssetId(v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose an asset" />
                    </SelectTrigger>
                    <SelectContent>
                      {(assetsQuery.data ?? []).map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.assetTag} · {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs font-bold">Employee</Label>
                  <Select
                    items={employeeItems}
                    value={employeeId}
                    onValueChange={(v) => v && setEmployeeId(v)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose an employee" />
                    </SelectTrigger>
                    <SelectContent>
                      {(employeesQuery.data ?? []).map((e: EmployeeView) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.work.fullName} · {e.employment?.employeeCode ?? ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {asset ? (
                <div className="rounded-md border border-line bg-surface-hover p-3 text-caption text-ink-muted">
                  <div className="mb-1 font-semibold text-ink-body">Context (read only)</div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <div className="text-caption font-bold uppercase">Purchase cost</div>
                      <div>
                        {asset.purchaseCost
                          ? formatMoney(asset.purchaseCost, asset.currency)
                          : "unknown"}
                      </div>
                    </div>
                    <div>
                      <div className="text-caption font-bold uppercase">Purchased</div>
                      <div>{formatAssetDate(asset.purchaseDate ?? null)}</div>
                    </div>
                    <div>
                      <div className="text-caption font-bold uppercase">Book value today</div>
                      <div>
                        {bookValue?.bookValue && bookValue.status === "VALUED"
                          ? formatMoney(bookValue.bookValue, bookValue.currency)
                          : "unknown"}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div>
                <Label htmlFor="recovery-amount" className="mb-1.5 block text-xs font-bold">
                  Amount
                </Label>
                <Input
                  id="recovery-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Enter the amount. Nothing is filled in for you."
                />
                <p className="mt-1 text-caption text-ink-muted">
                  Book value, replacement cost and original cost are all defensible. You are the
                  person accountable for the figure.
                </p>
              </div>

              <div>
                <Label htmlFor="recovery-reason" className="mb-1.5 block text-xs font-bold">
                  Reason
                </Label>
                <Textarea
                  id="recovery-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Not returned after exit, cracked screen on return, lost on a trip…"
                />
              </div>
            </>
          )}

          {error ? <p className="text-body-sm font-semibold text-danger">{error}</p> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={createMutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={createMutation.isPending || !valid}
              onClick={() => createMutation.mutate()}
              className="bg-ink text-white hover:bg-ink-strong"
            >
              {createMutation.isPending ? "Raising…" : "Raise recovery"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
