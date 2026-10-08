"use client"

import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"

import { listCategories, submitAssetRequest } from "@/lib/api/assets"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import { REFERENCE_STALE_MS } from "@/lib/query/default-options"
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
import { Textarea } from "@/components/ui/textarea"

/**
 * A staff member asking for a category of equipment — never a specific
 * asset. HR (or the requester's manager) decides which physical item
 * fulfils it later.
 *
 * No optimistic update: the request only appears once the server confirms
 * it was recorded.
 */
export function RequestDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const { accessToken } = useSession()

  const [categoryId, setCategoryId] = useState("")
  const [reason, setReason] = useState("")
  const [formError, setFormError] = useState<string | null>(null)

  const categoriesQuery = useQuery({
    queryKey: ["asset-categories"],
    staleTime: REFERENCE_STALE_MS,
    queryFn: () => listCategories(accessToken!),
    enabled: open,
  })

  function resetForm() {
    setCategoryId("")
    setReason("")
    setFormError(null)
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm()
    onOpenChange(next)
  }

  const requestMutation = useMutation({
    mutationFn: () => submitAssetRequest(accessToken!, { kind: "NEW_ITEM", categoryId, reason: reason.trim() }),
    onSuccess: () => {
      resetForm()
      onOpenChange(false)
      onSuccess()
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  const canSubmit = !!categoryId && reason.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request an asset</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 text-xs font-bold">Category</Label>
            <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string | null) =>
                    categoriesQuery.data?.find((c) => c.id === v)?.name ?? "Select a category"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(categoriesQuery.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="request-reason" className="mb-1.5 text-xs font-bold">
              Reason
            </Label>
            <Textarea
              id="request-reason"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why do you need it?"
            />
          </div>

          {formError ? <p className="text-[13px] font-semibold text-destructive">{formError}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={requestMutation.isPending}>
            Cancel
          </Button>
          <Button disabled={!canSubmit || requestMutation.isPending} onClick={() => requestMutation.mutate()}>
            {requestMutation.isPending ? "Submitting…" : "Submit request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
