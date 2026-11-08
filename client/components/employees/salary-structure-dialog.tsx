"use client"

import { useState } from "react"

import type { EmployeeView, SalaryStructure } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
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

/** Sentinel for "no structure" — a Select cannot hold a null value. */
const NONE = "__none__"

/**
 * Mounted only while an employee is selected, so `selected` re-seeds from that
 * employee through useState's initializer. The previous version seeded inside
 * `Dialog`'s `onOpenChange`, which never fires when `open` is driven by a
 * prop — so the seed never ran and the value carried over between employees.
 */
function StructureForm({
  employee,
  structures,
  pending,
  error,
  onOpenChange,
  onSubmit,
}: {
  employee: EmployeeView
  structures: SalaryStructure[]
  pending: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onSubmit: (salaryStructureId: string | null) => void
}) {
  const [selected, setSelected] = useState<string>(
    () => employee.payroll?.salaryStructure?.id ?? NONE
  )

  // Retired bands stay off the list: assigning to one would pay a rate
  // Finance has withdrawn. The server rejects it too (409).
  const assignable = structures.filter((s) => s.isActive)

  // Resolved against the FULL list, not `assignable`. The currently assigned
  // structure may itself be retired, and looking it up in the filtered list
  // would render its raw id in the trigger.
  const label = (value: string | null): string => {
    if (value === null || value === NONE) return "No structure"
    const match = structures.find((s) => s.id === value)
    return match ? `${match.name} · ${match.currency}` : "No structure"
  }

  const chosen = assignable.find((s) => s.id === selected) ?? null

  return (
    <>
      <DialogHeader>
        <DialogTitle>Salary structure for {employee.work.fullName}</DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <div className="text-caption leading-relaxed text-ink-muted">
          Finance authors the structures; HR decides who sits on which. The change applies to the
          next payroll run. Months already paid keep the figures they were paid on.
        </div>

        <div>
          <Label htmlFor="structure" className="mb-1.5 text-xs font-bold">
            Structure
          </Label>
          <Select value={selected} onValueChange={(v) => setSelected((v as string) ?? NONE)}>
            <SelectTrigger id="structure" className="w-full">
              {/* A render function, not a bare <SelectValue />: Base UI renders
                  the raw value when given no children, which printed the id. */}
              <SelectValue>{(v: string | null) => label(v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No structure</SelectItem>
              {assignable.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} · {s.currency}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* The band's actual money, so the choice is not made on a name. */}
        {chosen ? (
          <div className="rounded-md border border-line bg-surface-subtle px-4 py-3">
            <div className="text-caption font-bold tracking-wide text-ink-muted uppercase">
              {chosen.components.length === 0 ? "Monthly salary" : "Basic"}
            </div>
            <div className="font-heading text-title-sm font-bold">
              {formatMoney(chosen.basic, chosen.currency)}
            </div>
            <div className="mt-1.5 space-y-0.5">
              {chosen.components.map((c) => (
                <div key={c.id} className="flex justify-between text-caption">
                  <span className={c.kind === "DEDUCTION" ? "text-danger" : ""}>{c.label}</span>
                  <span>
                    {c.calc === "PERCENT_OF_BASIC"
                      ? `${c.value}% of basic`
                      : formatMoney(c.value, chosen.currency)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-warning-line bg-warning-tint px-4 py-3 text-caption leading-relaxed text-warning">
            With no structure this employee blocks every payroll run they fall into. Preflight names
            them rather than paying them nothing.
          </div>
        )}

        {error ? <div className="text-caption text-danger">{error}</div> : null}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          Cancel
        </Button>
        <Button disabled={pending} onClick={() => onSubmit(selected === NONE ? null : selected)}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  )
}

export function SalaryStructureDialog({
  employee,
  structures,
  pending,
  error,
  onOpenChange,
  onSubmit,
}: {
  employee: EmployeeView | null
  structures: SalaryStructure[]
  pending: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onSubmit: (salaryStructureId: string | null) => void
}) {
  return (
    <Dialog open={!!employee} onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent>
        {employee ? (
          <StructureForm
            employee={employee}
            structures={structures}
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
