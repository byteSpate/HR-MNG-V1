"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

/**
 * Shared by reject and revert — both overturn a request, and both require a
 * written reason that ends up on the employee's row.
 */
export function DecisionDialog({
  open,
  onOpenChange,
  title,
  confirmLabel,
  pending,
  error,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  confirmLabel: string
  pending: boolean
  error: string | null
  onConfirm: (note: string) => void
}) {
  // The note starts empty on mount; callers give this component a `key` per
  // decision so each one gets a fresh instance rather than a stale note.
  const [note, setNote] = useState("")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="decision-note" className="mb-1.5 text-xs font-bold">
              Reason
            </Label>
            <Textarea
              id="decision-note"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder="The employee will see this on their request."
            />
          </div>

          <div className="flex items-start gap-2.5 rounded-md border border-line bg-surface-hover p-3">
            <Checkbox id="notify-employee" disabled className="mt-0.5" />
            <div>
              <Label htmlFor="notify-employee" className="text-body-sm font-semibold text-ink-muted">
                Email the employee
              </Label>
              <p className="text-caption text-ink-muted">Coming soon — no email is sent yet.</p>
            </div>
          </div>

          {error ? <p className="text-body-sm font-semibold text-danger">{error}</p> : null}

          <DialogFooter>
            <Button
              type="button"
              disabled={pending || note.trim().length === 0}
              onClick={() => onConfirm(note.trim())}
              className="bg-ink text-white hover:bg-ink-strong"
            >
              {pending ? "Saving…" : confirmLabel}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
