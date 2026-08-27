"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"

import { setExitDetails } from "@/lib/api/employees"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type { EmployeeView, ExitReason } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

/**
 * Labels for the `ExitReason` enum (server/prisma/schema.prisma), each with a
 * Bangladesh Labour Act citation in the schema's own comment. `TERMINATION`,
 * `DISMISSAL`, `DISCHARGE` and `RETRENCHMENT` are employer-ended and drive
 * `employmentStatus: TERMINATED` server-side; every other reason reads as the
 * employee leaving and drives `RESIGNED`. That derivation happens in
 * `setExitDetails` on the server — this dialog only collects the reason.
 */
const EXIT_REASON_LABEL: Record<ExitReason, string> = {
  RESIGNATION: "Resignation",
  RETIREMENT: "Retirement",
  TERMINATION: "Termination",
  DISMISSAL: "Dismissal",
  DISCHARGE: "Discharge",
  RETRENCHMENT: "Retrenchment",
  CONTRACT_END: "Contract end",
  DEATH: "Death",
}

const EXIT_REASONS = Object.keys(EXIT_REASON_LABEL) as ExitReason[]

/**
 * Mounted only while open, matching `EditCardDialog` / `EditMyDetailsDialog`,
 * so `useState`'s initializer seeds the form once per open and no effect is
 * needed to re-seed it.
 *
 * It **seeds from the existing exit** when there is one. This form used to
 * start blank unconditionally, reasoning that an exit is recorded once. That
 * was wrong twice over: the server accepts an amendment right up until a
 * settlement is approved, and HR opening this a second time is almost always
 * here to correct a date. A blank form would have quietly cleared the note and
 * reset the reason to Resignation.
 */
function ExitForm({
  employee,
  onOpenChange,
  onSaved,
}: {
  employee: EmployeeView
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { accessToken } = useSession()
  const existing = employee.exit ?? null
  const [lastWorkingDay, setLastWorkingDay] = useState(existing?.lastWorkingDay ?? "")
  const [exitReason, setExitReason] = useState<ExitReason>(
    (existing?.exitReason as ExitReason | null) ?? "RESIGNATION"
  )
  const [exitNote, setExitNote] = useState(existing?.exitNote ?? "")
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      setExitDetails(accessToken!, employee.id, {
        lastWorkingDay,
        exitReason,
        ...(exitNote.trim() ? { exitNote: exitNote.trim() } : {}),
      }),
    onSuccess: () => {
      onOpenChange(false)
      onSaved()
    },
    onError: (err) => {
      // Surfaces the server's real message: the month-lock refusal, the
      // frozen-after-settlement 409, or "the last working day cannot precede
      // the joining date" — never replaced with local copy.
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    mutation.mutate()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Record exit — {employee.work.fullName}</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="lastWorkingDay" className="mb-1.5 text-xs font-bold">
            Last working day
          </Label>
          <Input
            id="lastWorkingDay"
            type="date"
            required
            value={lastWorkingDay}
            onChange={(e) => setLastWorkingDay(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="exitReason" className="mb-1.5 text-xs font-bold">
            Reason
          </Label>
          <Select
            items={EXIT_REASON_LABEL}
            value={exitReason}
            onValueChange={(v) => setExitReason(v as ExitReason)}
          >
            <SelectTrigger id="exitReason" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXIT_REASONS.map((reason) => (
                <SelectItem key={reason} value={reason}>
                  {EXIT_REASON_LABEL[reason]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="exitNote" className="mb-1.5 text-xs font-bold">
            Note (optional)
          </Label>
          <Textarea id="exitNote" value={exitNote} onChange={(e) => setExitNote(e.target.value)} />
        </div>
        {error ? <p className="text-[13px] font-semibold text-[#B03A3A]">{error}</p> : null}
        <DialogFooter>
          <Button
            type="submit"
            disabled={mutation.isPending || lastWorkingDay === ""}
            className="bg-[#17191C] text-white hover:bg-[#0E1012]"
          >
            {mutation.isPending ? "Saving…" : "Record exit"}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

export function ExitDetailsDialog({
  employee,
  open,
  onOpenChange,
  onSaved,
}: {
  employee: EmployeeView
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? <ExitForm employee={employee} onOpenChange={onOpenChange} onSaved={onSaved} /> : null}
      </DialogContent>
    </Dialog>
  )
}
