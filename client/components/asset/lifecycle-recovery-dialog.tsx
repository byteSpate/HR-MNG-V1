"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

/**
 * Retire / mark-lost, with Decision 4's optional recovery block on the lost
 * branch only. Retiring an asset is a write-off with no debt; marking one
 * lost is the moment the circumstances are known, so the dialog offers to
 * price a recovery — collapsed by default, and never a prefill.
 */
export function LifecycleRecoveryDialog({
  open,
  onOpenChange,
  kind,
  pending,
  error,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: "retire" | "lost" | null
  pending: boolean
  error: string | null
  onConfirm: (input: { note: string; recovery?: { amount: string; reason: string } }) => void
}) {
  const [note, setNote] = useState("")
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [recoveryAmount, setRecoveryAmount] = useState("")
  const [recoveryReason, setRecoveryReason] = useState("")

  const isLost = kind === "lost"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isLost ? "Mark this asset lost" : "Retire this asset"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-caption leading-relaxed text-ink-muted">
            {isLost
              ? "Marking it lost stops it being handed out and closes its custody. If the loss is somebody's to answer for, you can price a recovery in the same step."
              : "A retired asset leaves the register and is never handed out again."}
          </p>

          <div>
            <Label htmlFor="lifecycle-note" className="mb-1.5 block text-xs font-bold">
              {isLost ? "How it was lost" : "Why it is being retired"}
            </Label>
            <Textarea
              id="lifecycle-note"
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
              placeholder={isLost ? "Left on the train, gone from the store room…" : "Written off, obsolete…"}
            />
          </div>

          {isLost ? (
            <div className="rounded-md border border-line bg-surface-hover p-3">
              <button
                type="button"
                className="flex w-full items-center justify-between text-caption font-semibold"
                onClick={() => setRecoveryOpen((v) => !v)}
              >
                <span>Price a recovery for this loss</span>
                <span>{recoveryOpen ? "−" : "+"}</span>
              </button>
              {recoveryOpen ? (
                <div className="mt-3 space-y-3">
                  <div>
                    <Label htmlFor="lost-recovery-amount" className="mb-1.5 block text-xs font-bold">
                      Amount
                    </Label>
                    <Input
                      id="lost-recovery-amount"
                      inputMode="decimal"
                      value={recoveryAmount}
                      onChange={(e) => setRecoveryAmount(e.target.value)}
                      placeholder="You decide. Nothing is filled in."
                    />
                  </div>
                  <div>
                    <Label htmlFor="lost-recovery-reason" className="mb-1.5 block text-xs font-bold">
                      Reason
                    </Label>
                    <Textarea
                      id="lost-recovery-reason"
                      value={recoveryReason}
                      maxLength={1000}
                      onChange={(e) => setRecoveryReason(e.target.value)}
                      placeholder="Employee's responsibility, no insurance…"
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? <p className="text-body-sm font-semibold text-danger">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                pending ||
                note.trim().length === 0 ||
                (isLost && recoveryOpen && (recoveryAmount.trim() === "" || recoveryReason.trim() === ""))
              }
              onClick={() =>
                onConfirm(
                  isLost && recoveryOpen
                    ? {
                        note: note.trim(),
                        recovery: { amount: recoveryAmount.trim(), reason: recoveryReason.trim() },
                      }
                    : { note: note.trim() }
                )
              }
              className="bg-ink text-white hover:bg-ink-strong"
            >
              {pending ? "Saving…" : isLost ? "Mark lost" : "Retire asset"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
