"use client"

import { useMemo, useState } from "react"

import type { AdjustmentInput, ComponentKind, Currency } from "@/lib/api/types"
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

const COMMON_CODES = [
  { code: "FESTIVAL_BONUS", label: "Festival bonus", kind: "EARNING" as ComponentKind },
  { code: "ARREARS", label: "Arrears", kind: "EARNING" as ComponentKind },
  { code: "FESTIVAL_HOLIDAY_WAGES", label: "Festival holiday wages", kind: "EARNING" as ComponentKind },
  { code: "ADVANCE_RECOVERY", label: "Advance recovery", kind: "DEDUCTION" as ComponentKind },
]

/**
 * What the closed trigger shows. Base UI's Select renders the raw value
 * without this — the code rather than the label, and an employee's uuid
 * rather than their name.
 */
const PRESET_ITEMS = Object.fromEntries(
  COMMON_CODES.map((c) => [c.code, `${c.label} (${c.kind === "EARNING" ? "adds" : "deducts"})`])
)

export function AdjustmentDialog({
  open,
  onOpenChange,
  employees,
  month,
  year,
  pending,
  error,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  employees: Array<{ id: string; fullName: string; employeeCode: string }>
  month: number
  year: number
  pending: boolean
  error: string | null
  onSubmit: (input: AdjustmentInput) => void
}) {
  const employeeItems = useMemo(
    () => ({
      "": "Select an employee",
      ...Object.fromEntries(employees.map((e) => [e.id, `${e.fullName} (${e.employeeCode})`])),
    }),
    [employees]
  )

  const [employeeId, setEmployeeId] = useState("")
  const [preset, setPreset] = useState(COMMON_CODES[0].code)
  const [amount, setAmount] = useState("")
  const [currency, setCurrency] = useState<Currency>("BDT")
  const [reason, setReason] = useState("")

  const chosen = COMMON_CODES.find((c) => c.code === preset) ?? COMMON_CODES[0]
  const canSubmit = employeeId && Number(amount) > 0 && reason.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an adjustment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="adj-employee" className="mb-1.5 text-xs font-bold">
              Employee
            </Label>
            <Select
              items={employeeItems}
              value={employeeId}
              onValueChange={(v) => setEmployeeId(v as string)}
            >
              <SelectTrigger id="adj-employee" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Select an employee</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.fullName} ({e.employeeCode})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="adj-kind" className="mb-1.5 text-xs font-bold">
              Type
            </Label>
            <Select items={PRESET_ITEMS} value={preset} onValueChange={(v) => setPreset(v as string)}>
              <SelectTrigger id="adj-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMON_CODES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.label} ({c.kind === "EARNING" ? "adds" : "deducts"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="adj-amount" className="mb-1.5 text-xs font-bold">
                Amount
              </Label>
              <Input
                id="adj-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="adj-currency" className="mb-1.5 text-xs font-bold">
                Currency
              </Label>
              {/* HR thinks in BDT; the server converts into the employee's
                  payment currency before it enters the payslip sum. */}
              <Select value={currency} onValueChange={(v) => setCurrency(v as Currency)}>
                <SelectTrigger id="adj-currency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BDT">BDT</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="adj-reason" className="mb-1.5 text-xs font-bold">
              Reason (required)
            </Label>
            <Textarea
              id="adj-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="An unexplained line on someone's pay is a dispute waiting."
            />
          </div>

          {error ? <div className="text-caption text-danger">{error}</div> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit || pending}
            onClick={() =>
              onSubmit({
                employeeId,
                month,
                year,
                kind: chosen.kind,
                code: chosen.code,
                label: chosen.label,
                currency,
                amount: Number(amount),
                reason: reason.trim(),
              })
            }
          >
            Add adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
