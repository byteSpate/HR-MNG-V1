"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"

import { sendForRepair } from "@/lib/api/assets"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

/**
 * Sends an in-service asset to a vendor. Custody is untouched by this — an
 * assignment can stay open the whole time, because the employee's record and
 * the repair record answer different questions.
 *
 * No optimistic update: the row keeps its current status until the write
 * succeeds.
 */
export function RepairDialog({
  assetId,
  open,
  onOpenChange,
  onSuccess,
}: {
  assetId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const { accessToken } = useSession()

  const [fault, setFault] = useState("")
  const [vendor, setVendor] = useState("")
  const [expectedBack, setExpectedBack] = useState("")
  const [isWarranty, setIsWarranty] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function resetForm() {
    setFault("")
    setVendor("")
    setExpectedBack("")
    setIsWarranty(false)
    setFormError(null)
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm()
    onOpenChange(next)
  }

  const repairMutation = useMutation({
    mutationFn: () =>
      sendForRepair(accessToken!, assetId!, {
        fault: fault.trim(),
        vendor: vendor.trim() || undefined,
        expectedBack: expectedBack || undefined,
        isWarranty,
      }),
    onSuccess: () => {
      resetForm()
      onOpenChange(false)
      onSuccess()
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  const canSubmit = !!assetId && fault.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send for repair</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="repair-fault" className="mb-1.5 text-xs font-bold">
              Fault
            </Label>
            <Textarea
              id="repair-fault"
              value={fault}
              maxLength={500}
              onChange={(e) => setFault(e.target.value)}
              placeholder="What's wrong with it?"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="repair-vendor" className="mb-1.5 text-xs font-bold">
                Vendor <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input id="repair-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="repair-expected" className="mb-1.5 text-xs font-bold">
                Expected back <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="repair-expected"
                type="date"
                value={expectedBack}
                onChange={(e) => setExpectedBack(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Checkbox
              id="repair-warranty"
              checked={isWarranty}
              onCheckedChange={(checked) => setIsWarranty(checked === true)}
            />
            <Label htmlFor="repair-warranty" className="text-body-sm font-semibold">
              Covered by warranty
            </Label>
          </div>

          {formError ? <p className="text-body-sm font-semibold text-destructive">{formError}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={repairMutation.isPending}>
            Cancel
          </Button>
          <Button disabled={!canSubmit || repairMutation.isPending} onClick={() => repairMutation.mutate()}>
            {repairMutation.isPending ? "Sending…" : "Send for repair"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
