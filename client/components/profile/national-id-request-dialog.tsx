"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"

import { requestNationalIdChange } from "@/lib/api/employees"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * A separate dialog from "Edit my details" because this does not write the
 * field — it submits a request HR has to decide. Folding it into the generic
 * dialog would make "Save changes" lie about what pressing it does.
 */
function RequestForm({
  currentValue,
  onOpenChange,
  onRequested,
}: {
  currentValue: string | null
  onOpenChange: (open: boolean) => void
  onRequested: () => void
}) {
  const { accessToken } = useSession()
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => requestNationalIdChange(accessToken!, value),
    onSuccess: () => {
      onOpenChange(false)
      onRequested()
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  return (
    <>
      <DialogHeader>
        <DialogTitle>Request a national ID change</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setError(null)
          mutation.mutate()
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="new-national-id" className="mb-1.5 text-xs font-bold">
            New national ID
          </Label>
          <Input id="new-national-id" value={value} onChange={(e) => setValue(e.target.value)} />
          <p className="mt-1 text-[11.5px] text-[#A5AFBE]">
            {currentValue ? `Currently on file: ${currentValue}` : "Nothing is on file yet"}. HR
            reviews this before it takes effect.
          </p>
        </div>

        {error ? <p className="text-[13px] font-semibold text-[#B03A3A]">{error}</p> : null}

        <DialogFooter>
          <Button
            type="submit"
            disabled={mutation.isPending || value.trim() === ""}
            className="bg-[#17191C] text-white hover:bg-[#0E1012]"
          >
            {mutation.isPending ? "Submitting…" : "Submit request"}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

export function NationalIdRequestDialog({
  currentValue,
  open,
  onOpenChange,
  onRequested,
}: {
  currentValue: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRequested: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <RequestForm currentValue={currentValue} onOpenChange={onOpenChange} onRequested={onRequested} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
