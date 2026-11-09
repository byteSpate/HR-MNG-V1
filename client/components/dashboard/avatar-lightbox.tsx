"use client"

import { RiCloseLine } from "@remixicon/react"

import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Img } from "@/components/ds/img"

const LIGHTBOX_FRAME =
  "w-auto max-w-none gap-0 overflow-visible overflow-y-visible bg-transparent p-0 shadow-none ring-0 sm:max-w-none"

/**
 * A profile photo at the size it deserves — the thumbnail everywhere else is
 * sized for a list or a header, not for actually looking at someone's face.
 *
 * Sizing rule that matters: every constraint on the image is in VIEWPORT
 * units, never a percentage of its parent. The parent shrink-wraps the image
 * (`w-auto`), so a percentage width here would be circular — the browser
 * resolves that by falling back to the file's intrinsic pixel size, which
 * overflows the dialog and turns the base `overflow-y-auto` into scrollbars.
 * That is exactly the bug this replaces.
 *
 * `object-contain` with a free aspect ratio, not a square crop: a portrait ID
 * photo cropped to a square loses the top of the head, which defeats the
 * point of opening it.
 */
export function AvatarLightbox({
  src,
  alt,
  open,
  onOpenChange,
}: {
  src: string
  alt: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Every override here is load-bearing against the shared DialogContent
          card, and two of them are subtler than they look:

          `overflow-y-visible` is spelled out because tailwind-merge treats
          `overflow` and `overflow-y` as separate groups, so a bare
          `overflow-visible` leaves the base `overflow-y-auto` standing.

          The base `max-h-[85svh]` is deliberately NOT fought. `max-h-none`
          does not displace an arbitrary value in tailwind-merge, so both
          would ship and stylesheet order would decide the winner. Instead
          the image below caps itself at 82svh, comfortably under the
          container's 85svh, so the limit never engages and there is nothing
          to override. */}
      <DialogContent
        showCloseButton={false}
        className={LIGHTBOX_FRAME}
      >
        <DialogTitle className="sr-only">{alt}</DialogTitle>
        <div className="relative">
          <Img
            src={src}
            alt={alt}
            width={900}
            height={900}
            className="block h-auto max-h-[82svh] w-auto max-w-[90vw] rounded-2xl object-contain shadow-[0_24px_60px_-12px_rgba(10,14,20,0.55)]"
          />
          {/* Inside the frame, not floating off the corner: the image can be
              90vw on a phone, where an outset control clips off-screen. The
              translucent black pill keeps it legible over any photograph,
              light or dark, which a plain icon cannot promise. */}
          <DialogClose
            aria-label="Close"
            className="absolute top-2.5 right-2.5 grid size-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-[transform,background-color] duration-150 ease-out-quint hover:bg-black/75 focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none active:scale-90 motion-reduce:transition-none"
          >
            <RiCloseLine className="size-5" />
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  )
}
