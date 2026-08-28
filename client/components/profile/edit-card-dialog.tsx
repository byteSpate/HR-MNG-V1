"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"

import { updateEmployee } from "@/lib/api/employees"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type { EmployeeView, UpdateEmployeeInput } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export interface EditField {
  key: string
  label: string
  /**
   * "date" renders a YYYY-MM-DD input; the API expects that exact format.
   * "select" renders a dropdown and needs `options`.
   */
  kind?: "text" | "date" | "select"
  /** For `kind: "select"`. A closed set of values is a dropdown, not a text box. */
  options?: { value: string; label: string }[]
  /** Sits under the field, for anything the change has consequences for. */
  hint?: string
}

/**
 * The one place these labels live. Both profile pages read it, so the wording
 * on a card and the wording in the dropdown that edits that card cannot drift.
 */
export const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACT: "Contract",
  INTERN: "Intern",
}

const EMPLOYMENT_TYPE_OPTIONS = Object.entries(EMPLOYMENT_TYPE_LABEL).map(([value, label]) => ({
  value,
  label,
}))

/**
 * Per-card field lists.
 *
 * Per-card rather than one page-wide edit mode for two reasons: a single form
 * over twenty fields is a form people abandon, and a scoped PATCH body means
 * the audit before/after records a coherent change ("bank details updated")
 * rather than a diff of everything on the page.
 */
export const CARD_FIELDS: Record<string, EditField[]> = {
  Personal: [
    { key: "fullName", label: "Full name" },
    { key: "dateOfBirth", label: "Date of birth", kind: "date" },
    { key: "gender", label: "Gender" },
    { key: "nationalId", label: "National ID" },
    { key: "bloodGroup", label: "Blood group" },
    { key: "maritalStatus", label: "Marital status" },
  ],
  Contact: [
    { key: "phone", label: "Phone" },
    { key: "presentAddress", label: "Present address" },
    { key: "permanentAddress", label: "Permanent address" },
    { key: "emergencyContact", label: "Emergency contact" },
  ],
  // Employment type and joining date are here because they are *on the card*.
  // Without them this dialog opened over a card of six rows and offered to
  // change one of them, which reads as an Edit button that does not edit.
  //
  // Two rows are still absent by design and both say so on the card: employee
  // code is generated and never rewritten, and shift has its own dialog
  // because assigning one has attendance consequences worth a separate
  // confirmation.
  Employment: [
    { key: "designation", label: "Designation" },
    {
      key: "employmentType",
      label: "Employment type",
      kind: "select",
      options: EMPLOYMENT_TYPE_OPTIONS,
    },
    {
      key: "joiningDate",
      label: "Joining date",
      kind: "date",
      hint: "Attendance before this date is not tracked, and leave accrual counts from it.",
    },
    { key: "officeLocation", label: "Office location" },
    {
      key: "deviceUserId",
      label: "Device enrolment ID",
      // Says what is not built, rather than looking like a working setting.
      // The field stores a string and nothing reads it: there is no punch-
      // machine integration in this system, so filling it in has no effect on
      // attendance today. Checked across the whole server — no importer, no
      // job, no attendance code touches it.
      hint: "Their ID on a fingerprint or face punch machine. Stored for future use — no punch machine is connected yet, so filling this in does not affect attendance.",
    },
  ],
  Payroll: [
    { key: "bankName", label: "Bank" },
    { key: "bankAccountNumber", label: "Account number" },
    { key: "bankRoutingNumber", label: "Routing number" },
  ],
}

function currentValue(employee: EmployeeView, key: string): string {
  const groups: Record<string, unknown>[] = [
    employee.work as unknown as Record<string, unknown>,
    (employee.personal ?? {}) as unknown as Record<string, unknown>,
    (employee.contact ?? {}) as unknown as Record<string, unknown>,
    (employee.employment ?? {}) as unknown as Record<string, unknown>,
    (employee.payroll ?? {}) as unknown as Record<string, unknown>,
  ]
  for (const group of groups) {
    const value = group[key]
    if (typeof value === "string") return value
  }
  return ""
}

/**
 * Mounted only while the dialog is open, same as `EditMyDetailsDialog`'s
 * `EditForm`: unmounting is how React already expresses "start over", so a
 * fresh open re-seeds from the current employee via `useState`'s initializer
 * rather than an effect that re-seeds on `open` (the shape
 * `react-hooks/set-state-in-effect` exists to catch).
 */
function EditForm({
  employee,
  title,
  fields,
  onOpenChange,
  onSaved,
}: {
  employee: EmployeeView
  title: string
  fields: EditField[]
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { accessToken } = useSession()

  // Offered if and only if the server said this caller may write it.
  const offered = fields.filter((f) => employee.editableFields.includes(f.key))

  /**
   * What the fields held when the dialog opened, so `handleSubmit` can send
   * only what moved. `useState` rather than a ref: the form is remounted on
   * every open, so this is seeded once and never needs updating.
   */
  const [original] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {}
    for (const field of offered) seed[field.key] = currentValue(employee, field.key)
    return seed
  })
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...original }))
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (input: UpdateEmployeeInput) => updateEmployee(accessToken!, employee.id, input),
    onSuccess: () => {
      onOpenChange(false)
      onSaved()
    },
    onError: (err) => {
      // Surface the server's message verbatim — it names every forbidden
      // field on a 403, or the real validation failure on a 400.
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // Only what changed. Two reasons, and the second is a real bug the earlier
    // version had: the audit before/after should read as one coherent change
    // rather than a rewrite of every field on the card, *and* several fields
    // the server accepts are optional-but-not-nullable (`designation`,
    // `employmentType`, `joiningDate`). Re-sending an untouched blank one as
    // null is a 400 on a save the user did not ask to make.
    const input: Record<string, string | null> = {}
    for (const field of offered) {
      const next = (values[field.key] ?? "").trim()
      if (next === original[field.key]) continue
      // An emptied field is an explicit clear, which the API expresses as
      // null. Sending "" would fail the server's min(1) validator.
      input[field.key] = next === "" ? null : next
    }

    if (Object.keys(input).length === 0) {
      onOpenChange(false)
      return
    }
    mutation.mutate(input as UpdateEmployeeInput)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit {title.toLowerCase()}</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        {offered.map((field) => (
          <div key={field.key}>
            <Label htmlFor={field.key} className="mb-1.5 text-xs font-bold">
              {field.label}
            </Label>
            {field.kind === "select" ? (
              <Select
                value={values[field.key] ?? ""}
                onValueChange={(next) =>
                  setValues((v) => ({ ...v, [field.key]: next ?? "" }))
                }
              >
                <SelectTrigger id={field.key} className="w-full">
                  <SelectValue>
                    {(v: string | null) =>
                      field.options?.find((o) => o.value === v)?.label ?? "Not set"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(field.options ?? []).map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={field.key}
                type={field.kind === "date" ? "date" : "text"}
                value={values[field.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
              />
            )}
            {field.hint ? (
              <p className="mt-1.5 text-[11.5px] leading-snug text-[#5F6B7C]">{field.hint}</p>
            ) : null}
          </div>
        ))}
        {error ? <p className="text-[13px] font-semibold text-[#B03A3A]">{error}</p> : null}
        <DialogFooter>
          <Button
            type="submit"
            disabled={mutation.isPending}
            className="bg-[#17191C] text-white hover:bg-[#0E1012]"
          >
            {mutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

export function EditCardDialog({
  employee,
  title,
  fields,
  open,
  onOpenChange,
  onSaved,
}: {
  employee: EmployeeView
  title: string
  fields: EditField[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted only while open — see EditForm's comment. */}
        {open ? (
          <EditForm
            employee={employee}
            title={title}
            fields={fields}
            onOpenChange={onOpenChange}
            onSaved={onSaved}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
