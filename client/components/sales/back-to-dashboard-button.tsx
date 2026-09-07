"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { RiArrowLeftLine } from "@remixicon/react"

import { ClickBurst } from "@/components/sales/click-burst"
import { ROLE_ROUTES } from "@/lib/auth/role-routes"
import { useSession } from "@/lib/auth/session-context"

// A dark rainbow, not a grayscale one: the same six hues as SalesHubButton
// (rose, orange, yellow, green, cyan, indigo), each dropped to its own
// deep/muted shade. Grayscale read as "a dark outline", not "an effect" —
// this keeps the multicolour identity while suiting the calmer exit action.
const DARK_RAINBOW = ["#7f1d1d", "#7c2d12", "#713f12", "#14532d", "#164e63", "#312e81"]

// Same reasoning as SalesHubButton's NAVIGATE_DELAY_MS: a real route change
// completes faster than the burst can paint, so the actual navigation is
// held back just long enough for the click to register visually first.
const NAVIGATE_DELAY_MS = 160

/**
 * The way back to a role dashboard, shown only inside the Sales Hub — the
 * mirror image of SalesHubButton, which hides itself in exactly this slot
 * for the same reason: a door back to where you already are is dead weight
 * in the header everywhere else.
 *
 * Built from the same ring-frame + burst structure as SalesHubButton rather
 * than the shared shadcn `Button` — that component puts its background,
 * padding and radius on one root element, and the ring trick needs an
 * opaque pill sitting *above* a separately clipped, absolutely-positioned
 * frame. `bg-primary`/`text-primary-foreground` are used directly instead:
 * the same named tokens the shadcn `default` variant itself reads from
 * (`bg-primary text-primary-foreground` in `buttonVariants`), which happen
 * to render near-black on near-white in this theme — asked for by name, not
 * hardcoded, so a theme change still carries this button along.
 *
 * The ring is the same animated conic-gradient border as the hub's own
 * door, just in a darker, more muted palette — echoing the rainbow motif
 * rather than repeating it, since this is the quieter, calmer action.
 *
 * Destination is computed from the person's role, not from browser history,
 * which is empty on a fresh tab and wrong after a refresh. Shown whenever
 * the route is under /sales and the session has resolved, regardless of
 * salesRole — if you are on the page at all, you need a way back.
 */
export function BackToDashboardButton() {
  const pathname = usePathname()
  const router = useRouter()
  const { user } = useSession()
  const [burstKey, setBurstKey] = useState(0)
  const navigateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (navigateTimer.current) clearTimeout(navigateTimer.current)
    }
  }, [])

  if (!pathname.startsWith("/sales") || !user) return null

  const href = ROLE_ROUTES[user.role]

  function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    event.preventDefault()
    setBurstKey((k) => k + 1)
    navigateTimer.current = setTimeout(() => router.push(href), NAVIGATE_DELAY_MS)
  }

  return (
    <Link
      href={href}
      aria-label="Back to your dashboard"
      onClick={handleClick}
      className="group relative isolate inline-flex shrink-0 outline-offset-2 focus-visible:outline-2 focus-visible:outline-[#17191C]/60"
    >
      {/* Same clipped ring-frame technique as SalesHubButton, dark palette. */}
      <span aria-hidden className="absolute -inset-[1.5px] overflow-hidden rounded-full">
        <span className="absolute top-1/2 left-1/2 size-44 -translate-x-1/2 -translate-y-1/2">
          <span className="absolute inset-0 animate-[spin_3s_linear_infinite] bg-[conic-gradient(from_225deg,#7f1d1d,#7c2d12,#713f12,#14532d,#164e63,#312e81,#7f1d1d)] transition-[filter,animation-duration] duration-150 ease-out group-hover:[animation-duration:0.8s] group-active:brightness-150 group-active:saturate-150 motion-reduce:animate-none" />
        </span>
      </span>

      <span className="relative z-10 flex h-8.5 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[12.5px] font-bold text-primary-foreground shadow-[0_1px_2px_rgba(23,25,28,0.2)] transition-[transform,box-shadow] duration-150 ease-out-quint group-hover:-translate-y-1 group-hover:scale-[1.03] group-hover:shadow-[0_14px_26px_-12px_rgba(23,25,28,0.6)] group-active:translate-y-0 group-active:scale-95 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0 motion-reduce:group-hover:scale-100">
        <RiArrowLeftLine className="size-3.5" aria-hidden />
        Dashboard
      </span>

      {burstKey > 0 ? <ClickBurst key={burstKey} colors={DARK_RAINBOW} /> : null}
    </Link>
  )
}
