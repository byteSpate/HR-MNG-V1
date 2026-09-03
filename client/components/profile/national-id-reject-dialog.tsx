"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

/**
 * Not `DecisionDialog` from `components/leave/`: that one always requires a
 * note (approve here needs none) and carries a disabled "coming soon" email
 * checkbox that would be actively wrong here — this flow does send one.
 */
export function NationalIdRejectDialog({
  open,
  onOpenChange,
  pending,
  error,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  error: string | null
  onConfirm: (note: string) => void
}) {
  const [note, setNote] = useState("")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject the national ID change</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="reject-note" className="mb-1.5 text-xs font-bold">
              Reason
            </Label>
            <Textarea
              id="reject-note"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder="The employee will see this by email."
            />
          </div>

          {error ? <p className="text-[13px] font-semibold text-[#B03A3A]">{error}</p> : null}

          <DialogFooter>
            <Button
              type="button"
              disabled={pending || note.trim().length === 0}
              onClick={() => onConfirm(note.trim())}
              className="bg-[#17191C] text-white hover:bg-[#0E1012]"
            >
              {pending ? "Saving…" : "Reject"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
