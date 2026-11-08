"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

/**
 * Shared by the employee's "Fix this day" and HR's "Log correction".
 *
 * The two differ in authority, not in shape: the employee is requesting a
 * change to their own record and it returns to the approval queue, while
 * HR's is settled on the spot. `description` carries that difference to the
 * person using it.
 *
 * Callers pass a `key` per target record so each opens with empty fields
 * rather than the previous row's values.
 */
export function TimeAmendmentDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  defaultCheckIn,
  defaultCheckOut,
  pending,
  error,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  defaultCheckIn?: string
  defaultCheckOut?: string
  pending: boolean
  error: string | null
  onConfirm: (body: { checkIn?: string; checkOut?: string; note: string }) => void
}) {
  const [checkIn, setCheckIn] = useState(defaultCheckIn ?? "")
  const [checkOut, setCheckOut] = useState(defaultCheckOut ?? "")
  const [note, setNote] = useState("")

  const hasTime = checkIn.length > 0 || checkOut.length > 0
  const canSubmit = hasTime && note.trim().length > 0 && !pending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="amend-in" className="mb-1.5 text-xs font-bold">
                Check in
              </Label>
              <Input
                id="amend-in"
                type="time"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="amend-out" className="mb-1.5 text-xs font-bold">
                Check out
              </Label>
              <Input
                id="amend-out"
                type="time"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
              />
            </div>
          </div>
          <p className="text-caption text-ink-muted">
            Office local time. Leave a field blank to keep what is already recorded.
          </p>

          <div>
            <Label htmlFor="amend-note" className="mb-1.5 text-xs font-bold">
              Reason
            </Label>
            <Textarea
              id="amend-note"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What happened, and why the recorded time is wrong."
            />
          </div>

          {error ? <p className="text-body-sm font-semibold text-danger">{error}</p> : null}

          <DialogFooter>
            <Button
              type="button"
              disabled={!canSubmit}
              onClick={() =>
                onConfirm({
                  checkIn: checkIn || undefined,
                  checkOut: checkOut || undefined,
                  note: note.trim(),
                })
              }
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
