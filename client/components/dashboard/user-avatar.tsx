"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"
import { initialsFrom } from "@/lib/auth/use-identity"
import { Img } from "@/components/ds/img"

/**
 * Muted tints for the initials fallback. A directory of forty people with no
 * photos was forty identical grey squares — the eye had nothing to lock onto,
 * so scanning the grid meant reading every name. A stable colour per person
 * makes a card recognisable before it is read.
 *
 * Every pair clears 4.5:1, so the initials stay legible rather than decorative.
 */
const TINTS = [
  { bg: "#E7EDF7", fg: "#33507A" },
  { bg: "#E8F0EA", fg: "#3A5C43" },
  { bg: "#F5EBE4", fg: "#7A4E2E" },
  { bg: "#EEEAF6", fg: "#4F3D78" },
  { bg: "#E5F0F1", fg: "#2F5B60" },
  { bg: "#F6E9EC", fg: "#7A3B4C" },
] as const

/** Stable across renders and reloads: the same person is always the same
    colour, which is the entire point. */
function tintFor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return TINTS[hash % TINTS.length]
}

export function UserAvatar({
  name,
  avatarUrl,
  className,
  textClassName,
}: {
  name: string
  avatarUrl?: string | null
  /** Owns size and radius. Callers differ: circles in the chrome, rounded
      squares on the cards, matching what each already looked like. */
  className?: string
  textClassName?: string
}) {
  const [loaded, setLoaded] = useState(false)
  const tint = tintFor(name)

  return (
    // A one-cell grid, so the photo and the initials occupy the same square
    // and one can fade over the other without absolute positioning.
    <span
      className={cn("grid size-9 shrink-0 overflow-hidden rounded-full", className)}
      style={{ background: tint.bg }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "col-start-1 row-start-1 grid place-items-center text-body-sm font-bold",
          textClassName
        )}
        style={{ color: tint.fg }}
      >
        {initialsFrom(name)}
      </span>
      {avatarUrl ? (
        <Img
          src={avatarUrl}
          alt=""
          width={128}
          height={128}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          // A photo arriving mid-scroll should not pop. It fades in over the
          // initials, which are already the right size in the right place, so
          // the swap reads as one element resolving rather than two trading
          // places. Opacity only — this stays on the GPU.
          className={cn(
            "col-start-1 row-start-1 size-full object-cover transition-opacity duration-200 ease-out-quint motion-reduce:transition-none",
            loaded ? "opacity-100" : "opacity-0"
          )}
        />
      ) : null}
    </span>
  )
}
