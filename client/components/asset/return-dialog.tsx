"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"

import { returnAsset, uploadAssignmentAttachment } from "@/lib/api/assets"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { CONDITION_LABEL } from "@/components/asset/asset-shared"

const CONDITIONS: AssetCondition[] = ["NEW", "GOOD", "FAIR", "DAMAGED"]

/**
 * Closes the open assignment. Decision 4: a damaged return is one of the two
 * moments the facts are fresh, so the dialog offers — collapsed by default —
 * to price a recovery. Opening it makes amount and reason required; leaving
 * it closed sends none.
 *
 * No optimistic update: the row stays ASSIGNED until the write succeeds.
 */
export function ReturnDialog({
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

  const [conditionIn, setConditionIn] = useState<AssetCondition>("GOOD")
  const [returnNote, setReturnNote] = useState("")
  const [photos, setPhotos] = useState<File[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [recoveryAmount, setRecoveryAmount] = useState("")
  const [recoveryReason, setRecoveryReason] = useState("")

  function resetForm() {
    setConditionIn("GOOD")
    setReturnNote("")
    setPhotos([])
    setFormError(null)
    setRecoveryOpen(false)
    setRecoveryAmount("")
    setRecoveryReason("")
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm()
    onOpenChange(next)
  }

  const returnMutation = useMutation({
    mutationFn: async () => {
      const recovery =
        conditionIn === "DAMAGED" && recoveryOpen
          ? { amount: recoveryAmount.trim(), reason: recoveryReason.trim() }
          : undefined
      const assignment = await returnAsset(accessToken!, assetId!, {
        conditionIn,
        returnNote: returnNote.trim() || undefined,
        recovery,
      })
      for (const file of photos) {
        try {
          await uploadAssignmentAttachment(accessToken!, assignment.id, "CONDITION_IN", file)
        } catch (err) {
          throw new Error(
            `The asset was returned, but a photo failed to upload: ${
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Return this asset</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 text-xs font-bold">Condition on return</Label>
            <Select value={conditionIn} onValueChange={(v) => v && setConditionIn(v as AssetCondition)}>
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

          {conditionIn === "DAMAGED" ? (
            <div className="rounded-md border border-line bg-surface-hover p-3">
              <button
                type="button"
                className="flex w-full items-center justify-between text-caption font-semibold"
                onClick={() => setRecoveryOpen((v) => !v)}
              >
                <span>Price a recovery for the damage</span>
                <span>{recoveryOpen ? "−" : "+"}</span>
              </button>
              {recoveryOpen ? (
                <div className="mt-3 space-y-3">
                  <div>
                    <Label htmlFor="recovery-amount" className="mb-1.5 text-xs font-bold">
                      Amount
                    </Label>
                    <Input
                      id="recovery-amount"
                      inputMode="decimal"
                      value={recoveryAmount}
                      onChange={(e) => setRecoveryAmount(e.target.value)}
                      placeholder="Your call — never prefilled"
                    />
                  </div>
                  <div>
                    <Label htmlFor="recovery-reason" className="mb-1.5 text-xs font-bold">
                      Reason
                    </Label>
                    <Textarea
                      id="recovery-reason"
                      value={recoveryReason}
                      maxLength={1000}
                      onChange={(e) => setRecoveryReason(e.target.value)}
                      placeholder="Cracked screen, water damage, missing keys…"
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div>
            <Label htmlFor="return-note" className="mb-1.5 text-xs font-bold">
              Note <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="return-note"
              value={returnNote}
              maxLength={500}
              onChange={(e) => setReturnNote(e.target.value)}
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
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={returnMutation.isPending}>
            Cancel
          </Button>
          <Button
            disabled={
              !assetId ||
              returnMutation.isPending ||
              (conditionIn === "DAMAGED" && recoveryOpen && (recoveryAmount.trim() === "" || recoveryReason.trim() === ""))
            }
            onClick={() => returnMutation.mutate()}
          >
            {returnMutation.isPending ? "Returning…" : "Return asset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
