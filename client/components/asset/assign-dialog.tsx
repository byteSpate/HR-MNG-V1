"use client"

import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"

import { assignAsset, uploadAssignmentAttachment } from "@/lib/api/assets"
import { listEmployees } from "@/lib/api/employees"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type { AssetCondition } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AVATAR_ACCEPT, AVATAR_MAX_BYTES, FileUpload } from "@/components/ui/file-upload"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { CONDITION_LABEL } from "@/components/asset/asset-shared"

const CONDITIONS: AssetCondition[] = ["NEW", "GOOD", "FAIR", "DAMAGED"]

/**
 * Hands an available asset to an employee. The 409s here — the asset already
 * assigned, or retired — are HR hitting a real conflict, so the server's own
 * message is shown verbatim rather than a generic failure string.
 *
 * No optimistic update: the row stays AVAILABLE until the request actually
 * succeeds. Telling HR an asset was assigned when the write failed puts a
 * laptop nowhere.
 */
export function AssignDialog({
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

  const [employeeId, setEmployeeId] = useState("")
  const [conditionOut, setConditionOut] = useState<AssetCondition>("GOOD")
  const [issueNote, setIssueNote] = useState("")
  const [photos, setPhotos] = useState<File[]>([])
  const [formError, setFormError] = useState<string | null>(null)

  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: () => listEmployees(accessToken!),
    enabled: open,
  })

  function resetForm() {
    setEmployeeId("")
    setConditionOut("GOOD")
    setIssueNote("")
    setPhotos([])
    setFormError(null)
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm()
    onOpenChange(next)
  }

  const assignMutation = useMutation({
    mutationFn: async () => {
      const assignment = await assignAsset(accessToken!, assetId!, {
        employeeId,
        conditionOut,
        issueNote: issueNote.trim() || undefined,
      })
      // The asset is already handed over at this point. A photo that fails
      // to upload is a follow-up, not a reason to pretend the handover
      // itself did not happen.
      for (const file of photos) {
        try {
          await uploadAssignmentAttachment(accessToken!, assignment.id, "CONDITION_OUT", file)
        } catch (err) {
          throw new Error(
            `${assetId ? "The asset was assigned, but" : "A"} photo failed to upload: ${
              err instanceof ApiError ? err.message : "please attach it from the asset's detail sheet."
            }`
          )
        }
      }
      return assignment
    },
    onSuccess: () => {
      resetForm()
      onOpenChange(false)
      onSuccess()
    },
    onError: (err) => {
      setFormError(err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong. Please try again.")
    },
  })

  const canSubmit = !!employeeId && !!assetId

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign this asset</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 text-xs font-bold">Employee</Label>
            <Select value={employeeId} onValueChange={(v) => setEmployeeId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string | null) =>
                    employeesQuery.data?.find((e) => e.id === v)?.work.fullName ?? "Select an employee"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(employeesQuery.data ?? []).map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.work.fullName} · {e.work.designation}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="mb-1.5 text-xs font-bold">Condition on handover</Label>
            <Select value={conditionOut} onValueChange={(v) => v && setConditionOut(v as AssetCondition)}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string | null) => CONDITION_LABEL[(v as AssetCondition) ?? "GOOD"]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CONDITIONS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CONDITION_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="assign-note" className="mb-1.5 text-xs font-bold">
              Note <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="assign-note"
              value={issueNote}
              maxLength={500}
              onChange={(e) => setIssueNote(e.target.value)}
            />
          </div>

          <div>
            <Label className="mb-1.5 text-xs font-bold">
              Condition photos <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <div className="flex flex-wrap items-center gap-2">
              {photos.map((file, i) => (
                <span
                  key={`${file.name}-${i}`}
                  className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                >
                  {file.name}
                  <Button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    ×
                  </Button>
                </span>
              ))}
              <FileUpload
                accept={AVATAR_ACCEPT}
                maxBytes={AVATAR_MAX_BYTES}
                label="Add photo"
                onSelect={(file) => setPhotos((prev) => [...prev, file])}
              />
            </div>
          </div>

          {formError ? <p className="text-body-sm font-semibold text-destructive">{formError}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={assignMutation.isPending}>
            Cancel
          </Button>
          <Button disabled={!canSubmit || assignMutation.isPending} onClick={() => assignMutation.mutate()}>
            {assignMutation.isPending ? "Assigning…" : "Assign asset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
