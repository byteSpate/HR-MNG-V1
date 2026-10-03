"use client"

import { useRef } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { RiDeleteBinLine, RiDownload2Line, RiUpload2Line } from "@remixicon/react"
import { toast } from "sonner"

import { deleteAttachment, getAttachmentUrl, uploadJournalAttachment } from "@/lib/api/accounting"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type { JournalAttachment } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { formatLedgerDate } from "@/components/accounting/accounting-shared"
import { HelpLink } from "@/components/help/help-link"

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Supporting documents. Available on a posted journal as well as a draft —
 * a receipt that arrives a week after the entry is normal, and attaching a
 * file changes no accounting figure.
 */
export function JournalAttachments({
  journalId,
  attachments,
}: {
  journalId: string
  attachments: JournalAttachment[]
}) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["accounting", "journal", journalId] })

  const upload = useMutation({
    mutationFn: (file: File) => uploadJournalAttachment(accessToken!, journalId, file),
    onSuccess: () => {
      invalidate()
      toast.success("Attached")
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Upload failed"),
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteAttachment(accessToken!, id),
    onSuccess: () => {
      invalidate()
      toast.success("Attachment removed")
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not remove it"),
  })

  const open = async (id: string) => {
    // The window is opened on the click itself. A window opened after the wait
    // for the signed address is what a pop-up blocker stops, and then nothing
    // happens on screen.
    const win = window.open("", "_blank")
    try {
      // The URL is signed per request and expires in minutes, so it is
      // fetched at click time rather than rendered into the page.
      const { url } = await getAttachmentUrl(accessToken!, id)
      if (win) {
        win.location.href = url
      } else {
        // The browser stopped the new window. Open the file in this tab instead.
        toast.message("Opening the file in this tab")
        window.location.assign(url)
      }
    } catch (err) {
      win?.close()
      toast.error(err instanceof ApiError ? err.message : "Could not open the file")
    }
  }

  return (
    <section className="rounded-lg border">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-medium">Supporting documents</h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileInput.current?.click()}
          disabled={upload.isPending}
        >
          <RiUpload2Line className="size-4" /> {upload.isPending ? "Uploading…" : "Attach"}
        </Button>
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) upload.mutate(file)
            e.target.value = ""
          }}
        />
      </header>

      {attachments.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          Nothing attached yet.{" "}
          <HelpLink>How does this work?</HelpLink>
        </p>
      ) : (
        <ul className="divide-y">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="truncate">{a.fileName}</span>
              <span className="text-xs text-muted-foreground">
                {humanBytes(a.bytes)} · {formatLedgerDate(a.uploadedAt)}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <Button size="icon" variant="ghost" onClick={() => open(a.id)} aria-label="Open">
                  <RiDownload2Line className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => remove.mutate(a.id)}
                  disabled={remove.isPending}
                  aria-label="Remove"
                >
                  <RiDeleteBinLine className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
