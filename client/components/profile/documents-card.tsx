"use client"

import { useState } from "react"

import { deleteDocument, getDocumentUrl, uploadDocument } from "@/lib/api/employees"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type { DocumentItem, DocumentType } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { DOCUMENT_ACCEPT, DOCUMENT_MAX_BYTES, FileUpload } from "@/components/ui/file-upload"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const TYPE_LABEL: Record<DocumentType, string> = {
  CONTRACT: "Contract",
  NID: "National ID",
  CERTIFICATE: "Certificate",
  OFFER_LETTER: "Offer letter",
  RESIGNATION: "Resignation",
  OTHER: "Other",
}

const DOCUMENT_TYPES = Object.keys(TYPE_LABEL) as DocumentType[]

/** The two slots preflight and settlement care about; every other type is optional. */
const REQUIRED_TYPES = ["CONTRACT", "NID"] as const

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function DocumentsCard({
  employeeId,
  documents,
  footnote,
  canManage = false,
  onChanged,
}: {
  employeeId: string
  documents: DocumentItem[]
  footnote?: string
  /**
   * Upload and delete render if and only if this is true. My Profile passes
   * neither this nor `onChanged`, so it keeps the card read-only — the
   * component takes no role, only what its caller hands it.
   */
  canManage?: boolean
  onChanged?: () => void
}) {
  const { accessToken } = useSession()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploadType, setUploadType] = useState<DocumentType>("CONTRACT")

  /**
   * The URL is fetched on click, never on render.
   *
   * A signed document URL lives five minutes. Fetching them all when the page
   * paints would mean a page left open holds live links to every one of this
   * person's identity documents.
   */
  async function download(documentId: string) {
    setError(null)
    setBusyId(documentId)
    try {
      const { url } = await getDocumentUrl(accessToken!, employeeId, documentId)
      window.open(url, "_blank", "noopener,noreferrer")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open that file.")
    } finally {
      setBusyId(null)
    }
  }

  // No try/catch: FileUpload already catches whatever this throws and
  // renders the message itself.
  async function upload(file: File) {
    setError(null)
    await uploadDocument(accessToken!, employeeId, file, uploadType)
    onChanged?.()
  }

  async function remove(doc: DocumentItem) {
    if (!window.confirm(`Delete ${doc.fileName}? This cannot be undone.`)) return
    setError(null)
    setBusyId(doc.id)
    try {
      await deleteDocument(accessToken!, employeeId, doc.id)
      onChanged?.()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete that file.")
    } finally {
      setBusyId(null)
    }
  }

  const missingRequired = REQUIRED_TYPES.filter(
    (type) => !documents.some((d) => d.type === type)
  )

  return (
    <div className="flex flex-col rounded-md border border-line bg-white px-5.5 py-5">
      <div className="mb-4 text-lead font-bold">Documents</div>

      {canManage ? (
        <div className="mb-4 flex flex-wrap items-end gap-2.5 border-b border-surface-sunken pb-4">
          <div>
            <Label htmlFor="uploadType" className="mb-1.5 text-xs font-bold">
              Type
            </Label>
            {/* `items` is what makes the closed trigger read "National ID"
                rather than the raw NID enum key. */}
            <Select
              items={TYPE_LABEL}
              value={uploadType}
              onValueChange={(v) => setUploadType(v as DocumentType)}
            >
              <SelectTrigger id="uploadType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {TYPE_LABEL[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <FileUpload
            accept={DOCUMENT_ACCEPT}
            maxBytes={DOCUMENT_MAX_BYTES}
            label="Upload document"
            onSelect={upload}
          />
        </div>
      ) : null}

      {documents.length === 0 && !canManage ? (
        <p className="text-body-sm text-ink-muted">No documents on file.</p>
      ) : (
        <ul className="space-y-2.5">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-body-sm font-semibold">{TYPE_LABEL[doc.type]}</div>
                <div className="truncate text-caption text-ink-muted">
                  {doc.fileName} · {formatBytes(doc.bytes)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Button
                  type="button"
                  variant="link" className="h-auto p-0 text-caption font-semibold underline disabled:opacity-50"
                  disabled={busyId === doc.id}
                  onClick={() => void download(doc.id)}
                >
                  {busyId === doc.id ? "Opening…" : "Download"}
                </Button>
                {canManage ? (
                  <Button
                    type="button"
                    variant="link" className="h-auto p-0 text-caption font-semibold text-danger underline disabled:opacity-50"
                    disabled={busyId === doc.id}
                    onClick={() => void remove(doc)}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
          {canManage
            ? missingRequired.map((type) => (
                // An empty slot is a prompt; an absent row is invisible.
                <li key={type} className="flex items-center justify-between gap-3">
                  <div className="text-body-sm font-semibold text-ink-muted">
                    {TYPE_LABEL[type]} — not on file
                  </div>
                </li>
              ))
            : null}
        </ul>
      )}
      {error ? <p className="mt-3 text-body-sm font-semibold text-danger">{error}</p> : null}
      {footnote ? (
        <p className="mt-4 border-t border-surface-sunken pt-3 text-caption text-ink-muted">{footnote}</p>
      ) : null}
    </div>
  )
}
