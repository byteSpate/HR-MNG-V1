"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"

import { updateEmployee } from "@/lib/api/employees"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type { EmployeeView } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * Mounted only while open, the same pattern as EditCardDialog's EditForm:
 * unmounting is how React already expresses "start over", so a fresh open
 * re-seeds from the current employee through useState's initializer rather
 * than an effect.
 */
function NameForm({
  employee,
  onOpenChange,
  onSaved,
}: {
  employee: EmployeeView
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { accessToken } = useSession()
  const [fullName, setFullName] = useState(employee.work.fullName)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (name: string) => updateEmployee(accessToken!, employee.id, { fullName: name }),
    onSuccess: () => {
      onOpenChange(false)
      onSaved()
    },
    onError: (err) => {
      // Verbatim: a 403 here names every forbidden field.
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const next = fullName.trim()
    if (next === "") {
      setError("A name is required.")
      return
    }
    // Unchanged is not a change. The server would return 200 without writing
    // an audit row anyway; closing here saves the round trip.
    if (next === employee.work.fullName) {
      onOpenChange(false)
      return
    }
    mutation.mutate(next)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit name</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="edit-full-name" className="mb-1.5 text-xs font-bold">
            Full name
          </Label>
          <Input
            id="edit-full-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoFocus
          />
          <p className="mt-1 text-caption text-ink-muted">
            This is the name on payslips and the asset register. It does not change the
            employee code or the login email.
          </p>
        </div>
        {error ? <p className="text-body-sm font-semibold text-danger">{error}</p> : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={mutation.isPending}
            className="bg-ink text-white hover:bg-ink-strong"
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

/**
 * The name lives in the header, so the control that changes it does too.
 *
 * `fullName` was already writable by HR and already inside the Edit personal
 * dialog, but the Personal card never displayed the name, so nothing
 * suggested it could be changed at all.
 */
export function EditNameDialog({
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
        {open ? <NameForm employee={employee} onOpenChange={onOpenChange} onSaved={onSaved} /> : null}
      </DialogContent>
    </Dialog>
  )
}
