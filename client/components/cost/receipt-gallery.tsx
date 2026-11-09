"use client"

import { useState } from "react"

import { deleteCostReceipt, getCostReceiptUrl, uploadCostReceipt } from "@/lib/api/costs"
import { ApiError } from "@/lib/api/client"
import type { CostAttachment } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { DOCUMENT_ACCEPT, DOCUMENT_MAX_BYTES, FileUpload } from "@/components/ui/file-upload"

/**
 * One receipt thumbnail. Fetches a signed URL on click and opens it — never
 * prefetched, never cached in state. A signed URL lives five minutes, the
 * same rule `attachment-gallery.tsx` (the asset module's precedent) follows:
 * a page left open must not hold a live link to a receipt.
 */
function ReceiptThumb({
  attachment,
  accessToken,
  canManage,
  onDeleted,
}: {
  attachment: CostAttachment
  accessToken: string
  canManage: boolean
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function open() {
    setBusy(true)
    setError(null)
    try {
      const { url } = await getCostReceiptUrl(accessToken, attachment.id)
      window.open(url, "_blank", "noopener,noreferrer")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open that file.")
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setDeleting(true)
    setError(null)
    try {
      await deleteCostReceipt(accessToken, attachment.id)
      onDeleted()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove that receipt.")
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          onClick={() => void open()}
          disabled={busy || deleting}
          className="rounded-md border border-dashed px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:border-foreground/30 hover:text-foreground disabled:opacity-50"
        >
          {busy ? "Opening…" : attachment.fileName}
        </Button>
        {canManage ? (
          <Button
            type="button"
            onClick={() => void remove()}
            disabled={busy || deleting}
            className="text-muted-foreground hover:text-destructive disabled:opacity-50"
            aria-label={`Remove ${attachment.fileName}`}
          >
            ×
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-caption text-destructive">{error}</p> : null}
    </div>
  )
}

/**
 * A bill's receipts — the scanned invoice, the bKash screenshot, the
 * landlord's signed slip. Read-only for HR; Finance and Super Admin can also
 * add or remove one. `onChanged` invalidates the `["costs"]` prefix in the
 * caller, since a receipt is part of what `getCost` returns.
 */
export function ReceiptGallery({
  costId,
  attachments,
  accessToken,
  canManage,
  onChanged,
}: {
  costId: string
  attachments: CostAttachment[]
  accessToken: string
  canManage: boolean
  onChanged: () => void
}) {
  const [uploadError, setUploadError] = useState<string | null>(null)

  async function handleUpload(file: File) {
    setUploadError(null)
    try {
      await uploadCostReceipt(accessToken, costId, file)
      onChanged()
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : "Could not upload that receipt.")
    }
  }

  return (
    <div className="space-y-2">
      {attachments.length === 0 ? (
        <p className="text-xs text-muted-foreground">No receipts attached yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {attachments.map((a) => (
            <ReceiptThumb
              key={a.id}
              attachment={a}
              accessToken={accessToken}
              canManage={canManage}
              onDeleted={onChanged}
            />
          ))}
        </div>
      )}
      {canManage ? (
        <>
          <FileUpload
            accept={DOCUMENT_ACCEPT}
            maxBytes={DOCUMENT_MAX_BYTES}
            label="Add receipt"
            onSelect={handleUpload}
          />
          {uploadError ? <p className="text-caption text-destructive">{uploadError}</p> : null}
        </>
      ) : null}
    </div>
  )
}
