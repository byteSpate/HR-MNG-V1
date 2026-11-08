"use client"

import { useRef, useState } from "react"

import { ApiError } from "@/lib/api/client"
import { Button } from "@/components/ui/button"

/**
 * Select -> validate -> hand the File to the caller.
 *
 * The control does not know which endpoint it feeds; `onSelect` does the
 * upload. That is what lets the avatar picker and the document uploader share
 * it without either learning about the other.
 *
 * The size and format checks duplicate multer's, deliberately: they turn a
 * 15 MB round trip that ends in a 413 into an instant message.
 */
export function FileUpload({
  accept,
  maxBytes,
  label,
  onSelect,
  render,
}: {
  /** Extensions without the dot, e.g. ["pdf","jpg"]. Also drives the picker filter. */
  accept: string[]
  maxBytes: number
  label: string
  onSelect: (file: File) => Promise<void> | void
  render?: (props: { open: () => void; pending: boolean }) => React.ReactNode
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setError(null)

    const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
    if (!accept.includes(ext)) {
      setError(`Only ${accept.join(", ")} files are accepted.`)
      return
    }
    if (file.size > maxBytes) {
      setError(`That file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`)
      return
    }

    setPending(true)
    try {
      await onSelect(file)
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : "Something went wrong. Please try again."
      )
    } finally {
      setPending(false)
      // Cleared so selecting the same file twice fires change again.
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  const open = () => inputRef.current?.click()

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept.map((e) => `.${e}`).join(",")}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
        }}
      />
      {render ? (
        // eslint-disable-next-line react-hooks/refs -- `open` is only ever wired to an event handler by the caller, never invoked during render. The rule cannot see that, because `render()` itself runs during render.
        render({ open, pending })
      ) : (
        <Button type="button" variant="outline" onClick={open} disabled={pending}>
          {pending ? "Uploading…" : label}
        </Button>
      )}
      {error ? <p className="mt-1.5 text-body-sm font-semibold text-danger">{error}</p> : null}
    </div>
  )
}

export const AVATAR_ACCEPT = ["jpg", "jpeg", "png", "webp"]
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024
export const DOCUMENT_ACCEPT = ["pdf", "jpg", "jpeg", "png"]
export const DOCUMENT_MAX_BYTES = 15 * 1024 * 1024
