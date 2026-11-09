"use client"

import { useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { RiCloseLine, RiUploadLine } from "@remixicon/react"

import { deleteAttachment, getAttachmentUrl, uploadAssetAttachment } from "@/lib/api/assets"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type { AssetAttachment, AssetAttachmentKind } from "@/lib/api/types"
import { ConfirmDeleteDialog, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

/**
 * One thumbnail. Fetches a signed URL on click and opens it — never
 * prefetched, never cached in state. A signed attachment URL lives five
 * minutes, the same rule the profile documents card follows: a page left
 * open must not hold a live link to every photo an asset has ever had.
 */
function AttachmentThumb({
  attachment,
  accessToken,
  onDelete,
}: {
  attachment: AssetAttachment
  accessToken: string
  onDelete?: (attachment: AssetAttachment) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function open() {
    setBusy(true)
    setError(null)
    try {
      const { url } = await getAttachmentUrl(accessToken, attachment.id)
      window.open(url, "_blank", "noopener,noreferrer")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open that file.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center rounded-md border border-dashed">
        <Button
          type="button"
          onClick={() => void open()}
          disabled={busy}
          className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {busy ? "Opening…" : attachment.fileName}
        </Button>
        {onDelete ? (
          <Button
            type="button"
            aria-label={`Remove ${attachment.fileName}`}
            onClick={() => onDelete(attachment)}
            className="rounded-md px-1.5 py-1.5 text-muted-foreground hover:bg-danger-tint hover:text-danger"
          >
            <RiCloseLine className="size-3.5" aria-hidden />
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-caption text-destructive">{error}</p> : null}
    </div>
  )
}

/** The kinds that describe the asset itself. CONDITION_OUT and CONDITION_IN
 *  belong to a handover, not to the asset, so they are not offered here. */
const ASSET_KINDS: { value: AssetAttachmentKind; label: string }[] = [
  { value: "PHOTO", label: "Photo" },
  { value: "INVOICE", label: "Invoice" },
  { value: "WARRANTY", label: "Warranty" },
]

/**
 * Adding and removing an asset's files.
 *
 * `uploadAssetAttachment` and `deleteAttachment` both existed, on both sides,
 * with no caller: the gallery could display files that only the importer or a
 * handover had ever created, and nothing in the app could add an invoice or
 * take down a wrong one.
 */
export function AttachmentUploader({
  assetId,
  onChanged,
}: {
  assetId: string
  onChanged: () => void
}) {
  const { accessToken } = useSession()
  const inputRef = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState<AssetAttachmentKind>("PHOTO")
  const [error, setError] = useState<string | null>(null)

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadAssetAttachment(accessToken!, assetId, kind, file),
    onSuccess: () => {
      setError(null)
      // Cleared so picking the same file twice still fires a change event.
      if (inputRef.current) inputRef.current.value = ""
      onChanged()
    },
    onError: (err) => {
      if (inputRef.current) inputRef.current.value = ""
      setError(toMessage(err))
    },
  })

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={kind} onValueChange={(v) => setKind((v as AssetAttachmentKind) ?? "PHOTO")}>
          <SelectTrigger className="h-8 w-auto min-w-30 text-xs" aria-label="File kind">
            <SelectValue>{() => ASSET_KINDS.find((k) => k.value === kind)?.label ?? "Photo"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ASSET_KINDS.map((k) => (
              <SelectItem key={k.value} value={k.value}>
                {k.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant="outline"
          disabled={uploadMutation.isPending}
          onClick={() => inputRef.current?.click()}
          className="h-8 gap-1.5 px-2.5 text-xs font-semibold"
        >
          <RiUploadLine className="size-3.5" aria-hidden />
          {uploadMutation.isPending ? "Uploading…" : "Add file"}
        </Button>

        {/* Hidden rather than styled: a bare file input cannot be made to
            match the rest of the controls, and the button above is its label. */}
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) uploadMutation.mutate(file)
          }}
        />
      </div>
      {error ? <p className="text-caption font-semibold text-danger">{error}</p> : null}
    </div>
  )
}

/**
 * A row of attachment thumbnails — asset photos, invoices, warranty files,
 * or a handover's condition-out / condition-in shots. Shared by the asset
 * detail sheet's timeline and its asset-level attachments section, so there
 * is exactly one place the five-minute-URL rule lives.
 */
export function AttachmentGallery({
  attachments,
  accessToken,
  emptyLabel,
  canDelete,
  onChanged,
}: {
  attachments: AssetAttachment[]
  accessToken: string
  emptyLabel?: string
  /** HR / Super Admin only, matching the server's guard on the delete route. */
  canDelete?: boolean
  onChanged?: () => void
}) {
  const [deleting, setDeleting] = useState<AssetAttachment | null>(null)

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAttachment(accessToken, id),
    onSuccess: () => {
      setDeleting(null)
      onChanged?.()
    },
    onError: () => setDeleting(null),
  })

  if (attachments.length === 0) {
    return emptyLabel ? <p className="text-xs text-muted-foreground">{emptyLabel}</p> : null
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {attachments.map((a) => (
          <AttachmentThumb
            key={a.id}
            attachment={a}
            accessToken={accessToken}
            onDelete={canDelete ? setDeleting : undefined}
          />
        ))}
      </div>

      {/* A removed file is gone from storage, not just from this list, which
          is why this is the delete confirm rather than the softer one. */}
      <ConfirmDeleteDialog
        open={!!deleting}
        what={deleting?.fileName ?? "this file"}
        pending={deleteMutation.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
      />
    </>
  )
}
