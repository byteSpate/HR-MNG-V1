"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { payCost } from "@/lib/api/costs"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * Terminal for a bill: PENDING -> PAID, there is no un-pay, matching
 * `cost.service.ts#payCost`. `paidAt` defaults to today server-side when left
 * blank, so an empty date field here is a valid submission.
 */
export function PayDialog({
  costId,
  open,
  onOpenChange,
  period,
  onSuccess,
}: {
  costId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  period: { year: number; month: number }
  onSuccess: () => void
}) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()

  const [paidAt, setPaidAt] = useState("")
  const [paymentRef, setPaymentRef] = useState("")
  const [formError, setFormError] = useState<string | null>(null)

  function resetForm() {
    setPaidAt("")
    setPaymentRef("")
    setFormError(null)
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm()
    onOpenChange(next)
  }

  const payMutation = useMutation({
    mutationFn: () =>
      payCost(accessToken!, costId!, {
        paidAt: paidAt || undefined,
        paymentRef: paymentRef.trim() || undefined,
      }),
    onSuccess: () => {
      resetForm()
      onOpenChange(false)
      queryClient.invalidateQueries({ queryKey: ["costs"] })
      queryClient.invalidateQueries({ queryKey: ["cost-summary", period.year, period.month] })
      onSuccess()
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark this bill paid</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="pay-date" className="mb-1.5 text-xs font-bold">
              Paid on <span className="font-normal text-muted-foreground">(optional, defaults to today)</span>
            </Label>
            <Input id="pay-date" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="pay-ref" className="mb-1.5 text-xs font-bold">
              Payment reference <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="pay-ref"
              placeholder="Cheque no., bank ref, bKash TrxID…"
              value={paymentRef}
              onChange={(e) => setPaymentRef(e.target.value)}
            />
            <p className="mt-1.5 text-caption text-muted-foreground">
              A payment nobody can trace back to a bank statement is a payment nobody can verify.
            </p>
          </div>

          {formError ? <p className="text-body-sm font-semibold text-destructive">{formError}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={payMutation.isPending}>
            Cancel
          </Button>
          <Button disabled={!costId || payMutation.isPending} onClick={() => payMutation.mutate()}>
            {payMutation.isPending ? "Saving…" : "Mark paid"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
