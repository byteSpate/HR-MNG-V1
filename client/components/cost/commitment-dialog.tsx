"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { createCostCommitment, updateCostCommitment } from "@/lib/api/costs"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type { Currency, CostCategory, CostCommitment } from "@/lib/api/types"
import { ConfirmDialog } from "@/components/dashboard/record-kit"
import { todayLocalDate } from "@/components/cost/cost-shared"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

/**
 * Create, edit or end a recurring commitment. Ending is the only way a
 * commitment ever stops — never a delete, because the bills it explains
 * still exist after it ends (`cost.service.ts#updateCommitment`).
 *
 * `commitment === "new"` is create mode; a `CostCommitment` is edit mode.
 * Kept as one component because the field set barely differs and a create
 * dialog with no edit path would be the second place this form is written.
 */
export function CommitmentDialog({
  commitment,
  open,
  onOpenChange,
  categories,
  onSuccess,
}: {
  commitment: CostCommitment | "new" | null
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: CostCategory[]
  onSuccess: () => void
}) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const existing = commitment !== "new" ? commitment : null
  const isEdit = !!existing

  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? "")
  const [label, setLabel] = useState(existing?.label ?? "")
  const [payee, setPayee] = useState(existing?.payee ?? "")
  const [amount, setAmount] = useState(existing?.amount ?? "")
  const [currency, setCurrency] = useState<Currency>(existing?.currency ?? "BDT")
  const [dueDay, setDueDay] = useState(existing?.dueDay != null ? String(existing.dueDay) : "")
  const [startedOn, setStartedOn] = useState(existing?.startedOn ? existing.startedOn.slice(0, 10) : "")
  const [notes, setNotes] = useState(existing?.notes ?? "")
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmEnd, setConfirmEnd] = useState(false)

  function resetForm() {
    setCategoryId(existing?.categoryId ?? "")
    setLabel(existing?.label ?? "")
    setPayee(existing?.payee ?? "")
    setAmount(existing?.amount ?? "")
    setCurrency(existing?.currency ?? "BDT")
    setDueDay(existing?.dueDay != null ? String(existing.dueDay) : "")
    setStartedOn(existing?.startedOn ? existing.startedOn.slice(0, 10) : "")
    setNotes(existing?.notes ?? "")
    setFormError(null)
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm()
    onOpenChange(next)
  }

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["costs"] })
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createCostCommitment(accessToken!, {
        categoryId,
        label: label.trim(),
        payee: payee.trim(),
        amount: amount ? Number(amount) : undefined,
        currency,
        dueDay: dueDay ? Number(dueDay) : undefined,
        startedOn,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      resetForm()
      onOpenChange(false)
      invalidate()
      onSuccess()
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      updateCostCommitment(accessToken!, existing!.id, {
        label: label.trim(),
        payee: payee.trim(),
        amount: amount ? Number(amount) : null,
        currency,
        dueDay: dueDay ? Number(dueDay) : null,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      onOpenChange(false)
      invalidate()
      onSuccess()
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  const endMutation = useMutation({
    mutationFn: () =>
      updateCostCommitment(accessToken!, existing!.id, {
        // Local calendar date, not `toISOString().slice(0, 10)`. Dhaka runs
        // UTC+6, so before 6am local that shortcut stamps yesterday and ends
        // the commitment a day before Finance actually ended it.
        endedOn: todayLocalDate(),
      }),
    onSuccess: () => {
      setConfirmEnd(false)
      onOpenChange(false)
      invalidate()
      onSuccess()
    },
    onError: (err) => {
      setConfirmEnd(false)
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  /**
   * Ending is reversible on the server: `endedOn` is `.nullable()` in
   * `updateCommitmentSchema` and `cost.service.ts` clears the column when it
   * receives null. Nothing in the UI ever sent that, so an accidental end was
   * permanent, and with it the monthly "no rent recorded" prompt that is the
   * only reason a commitment record exists.
   */
  const reopenMutation = useMutation({
    mutationFn: () => updateCostCommitment(accessToken!, existing!.id, { endedOn: null }),
    onSuccess: () => {
      onOpenChange(false)
      invalidate()
      onSuccess()
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  const pending =
    createMutation.isPending ||
    updateMutation.isPending ||
    endMutation.isPending ||
    reopenMutation.isPending
  const canSubmit =
    !!categoryId && label.trim().length > 0 && payee.trim().length > 0 && (isEdit || startedOn.length > 0)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit fixed cost" : "New fixed cost"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 text-xs font-bold">Category</Label>
              <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? "")} disabled={isEdit}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string | null) => categories.find((c) => c.id === v)?.name ?? "Select a category"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="commitment-payee" className="mb-1.5 text-xs font-bold">
                Payee
              </Label>
              <Input id="commitment-payee" value={payee} onChange={(e) => setPayee(e.target.value)} />
            </div>
          </div>

          <div>
            <Label htmlFor="commitment-label" className="mb-1.5 text-xs font-bold">
              Label
            </Label>
            <Input
              id="commitment-label"
              placeholder="Office rent, Banani"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="commitment-amount" className="mb-1.5 text-xs font-bold">
                Amount <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="commitment-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">Leave blank if the bill varies monthly.</p>
            </div>
            <div>
              <Label htmlFor="commitment-currency" className="mb-1.5 text-xs font-bold">
                Currency
              </Label>
              <Select value={currency} onValueChange={(v) => setCurrency(v as Currency)}>
                <SelectTrigger id="commitment-currency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BDT">BDT</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="commitment-due-day" className="mb-1.5 text-xs font-bold">
                Due day <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="commitment-due-day"
                type="number"
                min="1"
                max="31"
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="commitment-started" className="mb-1.5 text-xs font-bold">
              Started on
            </Label>
            <Input
              id="commitment-started"
              type="date"
              value={startedOn}
              disabled={isEdit}
              onChange={(e) => setStartedOn(e.target.value)}
            />
            {isEdit ? (
              <p className="mt-1 text-[11px] text-muted-foreground">The start date is fixed once created.</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="commitment-notes" className="mb-1.5 text-xs font-bold">
              Notes <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="commitment-notes"
              value={notes}
              maxLength={2000}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {existing?.endedOn ? (
            <p className="text-[12.5px] text-muted-foreground">
              Ended {new Date(existing.endedOn).toLocaleDateString("en-US", { dateStyle: "medium" })}.
            </p>
          ) : null}

          {formError ? <p className="text-[13px] font-semibold text-destructive">{formError}</p> : null}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {isEdit && !existing?.endedOn ? (
            <Button
              type="button"
              variant="outline"
              className="mr-auto text-destructive"
              disabled={pending}
              onClick={() => setConfirmEnd(true)}
            >
              End commitment
            </Button>
          ) : null}
          {isEdit && existing?.endedOn ? (
            <Button
              type="button"
              variant="outline"
              className="mr-auto"
              disabled={pending}
              onClick={() => reopenMutation.mutate()}
            >
              {reopenMutation.isPending ? "Reopening…" : "Reopen"}
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          {/*
            No longer disabled once ended. The server accepts edits to an ended
            commitment, and freezing the form meant a typo in the label of a
            closed contract could never be corrected: the bills it explains
            still carry that label in every report.
          */}
          <Button
            disabled={!canSubmit || pending}
            onClick={() => (isEdit ? updateMutation.mutate() : createMutation.mutate())}
          >
            {pending ? "Saving…" : isEdit ? "Save changes" : "Create fixed cost"}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/*
        Ending stops the monthly "no rent recorded for March" prompt for good,
        which is the whole reason a commitment exists. It is reversible through
        Reopen, so this is the softer confirm and not the delete one.
      */}
      <ConfirmDialog
        open={confirmEnd}
        title="End this fixed cost?"
        body={
          <>
            {existing ? `${existing.label} ` : "This fixed cost "}
            stops being expected from today, so no further months will prompt you for a missing
            bill. Bills already recorded against it are untouched, and you can reopen it later.
          </>
        }
        confirmLabel={endMutation.isPending ? "Ending…" : "End it"}
        pending={endMutation.isPending}
        onCancel={() => setConfirmEnd(false)}
        onConfirm={() => endMutation.mutate()}
      />
    </Dialog>
  )
}
