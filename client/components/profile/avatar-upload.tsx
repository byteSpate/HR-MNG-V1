"use client"

import { Img } from "@/components/ds/img"
import { useState } from "react"
import { RiCloseLine, RiZoomInLine } from "@remixicon/react"

import { AvatarLightbox } from "@/components/dashboard/avatar-lightbox"
import { Button } from "@/components/ui/button"
import { AVATAR_ACCEPT, AVATAR_MAX_BYTES, FileUpload } from "@/components/ui/file-upload"

export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * The one photo that represents this whole page's subject — sized as a
 * profile-page hero (96px), not a list-row thumbnail. Was 64px, a size that
 * made an actual portrait look like an afterthought next to the name and
 * action buttons beside it.
 */
export function AvatarUpload({
  upload,
  remove,
  avatarUrl,
  fullName,
  editable,
  onChanged,
}: {
  /**
   * What to do with the chosen file, and how to take it away again.
   *
   * These were an `employeeId` the component turned into two API calls
   * itself. They are operations now because an administrative account has a
   * photo and no employee record — same control, different endpoint — and
   * baking the employee route in would have meant a second copy of all of
   * this for the sake of one URL.
   */
  upload: (file: File) => Promise<unknown>
  remove: () => Promise<unknown>
  avatarUrl: string | null
  fullName: string
  editable: boolean
  onChanged: () => void
}) {
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [photoOpen, setPhotoOpen] = useState(false)

  const image = avatarUrl ? (
    // A signed Cloudinary URL cannot be optimised, so Img is unoptimized.
    <Img src={avatarUrl} alt="" width={160} height={160} className="h-full w-full rounded-md object-cover" />
  ) : (
    <span className="text-display font-bold text-ink-muted">{initialsFrom(fullName)}</span>
  )

  if (!editable) {
    return (
      <>
        {avatarUrl ? (
          // Nothing to view without a real photo — two-letter initials stay a
          // plain, inert square, same as before.
          <button
            type="button"
            onClick={() => setPhotoOpen(true)}
            aria-label={`View ${fullName}'s photo`}
            className="group relative flex h-24 w-24 shrink-0 cursor-zoom-in items-center justify-center overflow-hidden rounded-md bg-surface-sunken transition-transform duration-150 ease-out-quint hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none active:translate-y-0 active:scale-97 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            {image}
            <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity duration-150 ease-out-quint group-hover:opacity-100 motion-reduce:transition-none">
              <RiZoomInLine className="size-6" aria-hidden="true" />
            </span>
          </button>
        ) : (
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-md bg-surface-sunken">
            {image}
          </div>
        )}
        {avatarUrl ? (
          <AvatarLightbox
            src={avatarUrl}
            alt={fullName}
            open={photoOpen}
            onOpenChange={setPhotoOpen}
          />
        ) : null}
      </>
    )
  }

  async function handleRemove() {
    setRemoveError(null)
    setRemoving(true)
    try {
      await remove()
      onChanged()
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      <div className="flex items-start gap-3">
        <FileUpload
          accept={AVATAR_ACCEPT}
          maxBytes={AVATAR_MAX_BYTES}
          label="Change photo"
          onSelect={async (file) => {
            await upload(file)
            onChanged()
          }}
          render={({ open, pending }) => (
            <Button
              type="button"
              onClick={open}
              disabled={pending || removing}
              className="group relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-md bg-surface-sunken"
              aria-label="Change profile photo"
            >
              {image}
              <span className="absolute inset-0 hidden items-center justify-center bg-black/55 text-caption font-bold text-white group-hover:flex">
                {pending ? "…" : "Change"}
              </span>
            </Button>
          )}
        />
        {/* A separate control from the photo itself, which already has a
            click action (change it). Stacked vertically under "Remove" so
            the photo's own click target stays single-purpose. */}
        {avatarUrl ? (
          <div className="flex flex-col items-start gap-1.5">
            {/* `variant="ghost"` matters here, not styling taste: the default
                variant fills `bg-primary` (near-black) with nothing in this
                className to override it, since no `bg-*` utility was ever
                passed — that solid fill behind grey text is the stray black
                "Remove" pill from the admin screenshot. Ghost has no default
                fill to fight. */}
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPhotoOpen(true)}
              className="h-auto gap-1 p-0 text-caption font-semibold text-ink-muted hover:bg-transparent hover:text-ink"
            >
              <RiZoomInLine className="size-3.5" />
              View
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={handleRemove}
              disabled={removing}
              className="h-auto gap-1 p-0 text-caption font-semibold text-ink-muted hover:bg-transparent hover:text-danger disabled:opacity-50"
            >
              <RiCloseLine className="size-3.5" />
              {removing ? "Removing…" : "Remove"}
            </Button>
          </div>
        ) : null}
      </div>
      {removeError ? (
        <p className="text-body-sm font-semibold text-danger">{removeError}</p>
      ) : null}
      {avatarUrl ? (
        <AvatarLightbox src={avatarUrl} alt={fullName} open={photoOpen} onOpenChange={setPhotoOpen} />
      ) : null}
    </div>
  )
}
