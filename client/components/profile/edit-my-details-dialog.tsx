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

/**
 * The six self-editable text fields, in the order they are shown.
 *
 * `permanentAddress` joined this list on 2026-09-02 — it used to change only
 * through HR with document proof, until the user decided it should change
 * directly, the same as `presentAddress`.
 *
 * `profilePicture` is a seventh self-editable field and is deliberately
 * absent: it takes a file rather than a value and posts to a different
 * endpoint, so it lives on the avatar in the header.
 */
const FIELDS = [
  { key: "phone", label: "Phone", hint: "Visible to colleagues in the staff directory" },
  { key: "presentAddress", label: "Present address" },
  { key: "permanentAddress", label: "Permanent address" },
  { key: "emergencyContact", label: "Emergency contact" },
  { key: "maritalStatus", label: "Marital status" },
  { key: "bloodGroup", label: "Blood group" },
] as const

type FieldKey = (typeof FIELDS)[number]["key"]

function initialValues(employee: EmployeeView): Record<FieldKey, string> {
  return {
    phone: employee.work.phone ?? "",
    presentAddress: employee.contact?.presentAddress ?? "",
    permanentAddress: employee.contact?.permanentAddress ?? "",
    emergencyContact: employee.contact?.emergencyContact ?? "",
    maritalStatus: employee.personal?.maritalStatus ?? "",
    bloodGroup: employee.personal?.bloodGroup ?? "",
  }
}

/**
 * The form is a separate component rendered only while the dialog is open, so
 * each open mounts it fresh and `useState` re-seeds from the current employee.
 *
 * The alternative — one always-mounted form re-seeded by an effect on `open` —
 * is what `react-hooks/set-state-in-effect` exists to catch, and it is right
 * to: unmounting is how React already expresses "start over".
 */
function EditForm({
  employee,
  onOpenChange,
  onSaved,
}: {
  employee: EmployeeView
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { accessToken } = useSession()
  const [values, setValues] = useState(() => initialValues(employee))
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (input: UpdateEmployeeInput) => updateEmployee(accessToken!, employee.id, input),
    onSuccess: () => {
      onOpenChange(false)
      onSaved()
    },
    onError: (err) => {
      // The dialog stays open so nothing typed is lost.
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  // The component knows no rules. A field is offered if and only if the server
  // said this caller may write it.
  const offered = FIELDS.filter((f) => employee.editableFields.includes(f.key))

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const input: UpdateEmployeeInput = {}
    for (const field of offered) {
      const next = values[field.key].trim()
      // An emptied field is an explicit clear, which the API expresses as
      // null. Sending "" would fail the min(1) validator.
      ;(input as Record<string, string | null>)[field.key] = next === "" ? null : next
    }
    mutation.mutate(input)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit my details</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        {offered.map((field) => (
          <div key={field.key}>
            <Label htmlFor={field.key} className="mb-1.5 text-xs font-bold">
              {field.label}
            </Label>
            <Input
              id={field.key}
              value={values[field.key]}
              onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
            />
            {"hint" in field && field.hint ? (
              <p className="mt-1 text-[11.5px] text-[#A5AFBE]">{field.hint}</p>
            ) : null}
          </div>
        ))}

        <p className="text-[12px] text-[#A5AFBE]">
          Everything else on your profile is maintained by HR.
        </p>

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

export function EditMyDetailsDialog({
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
        {/* Mounted only while open — see EditForm's note on why this replaces
            an effect that re-seeded the fields. */}
        {open ? (
          <EditForm employee={employee} onOpenChange={onOpenChange} onSaved={onSaved} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
