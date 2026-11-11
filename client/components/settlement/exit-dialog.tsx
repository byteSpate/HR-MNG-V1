"use client"

import { useState } from "react"

import type { ExitDetailsInput, ExitReason } from "@/lib/api/types"
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
import { EXIT_REASON_EFFECT, EXIT_REASON_LABEL } from "@/components/payroll/payroll-shared"

const REASONS: ExitReason[] = [
  "RESIGNATION",
  "RETIREMENT",
  "TERMINATION",
  "DISMISSAL",
  "DISCHARGE",
  "RETRENCHMENT",
  "CONTRACT_END",
  "DEATH",
]

export function ExitDialog({
  open,
  onOpenChange,
  employeeName,
  pending,
  error,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  employeeName: string
  pending: boolean
  error: string | null
  onSubmit: (input: ExitDetailsInput) => void
}) {
  const [lastWorkingDay, setLastWorkingDay] = useState("")
  const [exitReason, setExitReason] = useState<ExitReason>("RESIGNATION")
  const [exitNote, setExitNote] = useState("")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record exit details: {employeeName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="exit-date" className="mb-1.5 text-xs font-bold">
              Last working day
            </Label>
            <Input
              id="exit-date"
              type="date"
              value={lastWorkingDay}
              onChange={(e) => setLastWorkingDay(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="exit-reason" className="mb-1.5 text-xs font-bold">
              Reason
            </Label>
            <Select
              items={EXIT_REASON_LABEL}
              value={exitReason}
              onValueChange={(v) => setExitReason(v as ExitReason)}
            >
              <SelectTrigger id="exit-reason" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((reason) => (
                  <SelectItem key={reason} value={reason}>
                    {EXIT_REASON_LABEL[reason]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* What the reason will drive, so it reads as a money decision
                rather than a filing category. */}
            <div className="mt-1.5 text-caption text-ink-muted">
              {EXIT_REASON_EFFECT[exitReason]}
            </div>
          </div>

          <div>
            <Label htmlFor="exit-note" className="mb-1.5 text-xs font-bold">
              Note
            </Label>
            <Textarea
              id="exit-note"
              value={exitNote}
              onChange={(e) => setExitNote(e.target.value)}
              placeholder="Anything the reason does not say. For example: notice waived by mutual agreement."
            />
          </div>

          {error ? <div className="text-caption text-danger">{error}</div> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={!lastWorkingDay || pending}
            onClick={() =>
              onSubmit({
                lastWorkingDay,
                exitReason,
                exitNote: exitNote.trim() || undefined,
              })
            }
          >
            Save exit details
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
