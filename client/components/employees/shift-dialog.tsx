"use client"

import { useState } from "react"

import type { EmployeeView, Shift } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** Sentinel for "no shift" — a Select cannot hold a null value. Unassigned
    resolves to the General shift, same wording as the create-employee form. */
const GENERAL = "__general__"

function formatOffDays(days: number[]): string {
  if (days.length === 0) return "No weekly off"
  return days
    .slice()
    .sort((a, b) => a - b)
    .map((d) => WEEKDAY_LABELS[d])
    .join(", ")
}

/**
 * Mounted only while an employee is selected — same reasoning as
 * `SalaryStructureDialog`'s `StructureForm`: `useState`'s initializer is what
 * re-seeds `selected` per employee, and that only runs on mount.
 */
function ShiftForm({
  employee,
  shifts,
  pending,
  error,
  onOpenChange,
  onSubmit,
}: {
  employee: EmployeeView
  shifts: Shift[]
  pending: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onSubmit: (shiftId: string | null) => void
}) {
  const [selected, setSelected] = useState<string>(
    () => employee.employment?.shift?.id ?? GENERAL
  )

  const chosen = shifts.find((s) => s.id === selected) ?? null

  const label = (value: string | null): string => {
    if (value === null || value === GENERAL) return "General shift"
    const match = shifts.find((s) => s.id === value)
    return match ? match.name : "General shift"
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Shift for {employee.work.fullName}</DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <div className="text-caption leading-relaxed text-ink-muted">
          Attendance — late arrivals, hours worked, the weekly off day — is judged against
          whichever shift is assigned here. Leave unset to use the General shift.
        </div>

        <div>
          <Label htmlFor="shift" className="mb-1.5 text-xs font-bold">
            Shift
          </Label>
          <Select value={selected} onValueChange={(v) => setSelected((v as string) ?? GENERAL)}>
            <SelectTrigger id="shift" className="w-full">
              {/* A render function, not a bare <SelectValue />: Base UI renders
                  the raw value when given no children, which printed the id. */}
              <SelectValue>{(v: string | null) => label(v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={GENERAL}>General shift</SelectItem>
              {shifts.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} ({s.startTime}–{s.endTime})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* The shift's actual hours, so the choice is not made on a name
            alone — mirrors the money preview in the salary-structure dialog. */}
        {chosen ? (
          <div className="rounded-md border border-line bg-surface-subtle px-4 py-3">
            <div className="text-caption font-bold tracking-wide text-ink-muted uppercase">
              Window
            </div>
            <div className="font-heading text-title-sm font-bold">
              {chosen.startTime}–{chosen.endTime}
            </div>
            <div className="mt-1.5 space-y-0.5 text-caption text-ink-muted">
              <div>{chosen.graceMinutes} min grace · {chosen.breakMinutes} min break</div>
              <div>Weekly off: {formatOffDays(chosen.weeklyOffDays)}</div>
            </div>
          </div>
        ) : null}

        {error ? <div className="text-caption text-danger">{error}</div> : null}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          Cancel
        </Button>
        <Button disabled={pending} onClick={() => onSubmit(selected === GENERAL ? null : selected)}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  )
}

export function ShiftDialog({
  employee,
  shifts,
  pending,
  error,
  onOpenChange,
  onSubmit,
}: {
  employee: EmployeeView | null
  shifts: Shift[]
  pending: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onSubmit: (shiftId: string | null) => void
}) {
  return (
    <Dialog open={!!employee} onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent>
        {employee ? (
          <ShiftForm
            employee={employee}
            shifts={shifts}
            pending={pending}
            error={error}
            onOpenChange={onOpenChange}
            onSubmit={onSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
