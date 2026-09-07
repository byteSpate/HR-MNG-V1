"use client"

import { usePathname } from "next/navigation"
import { RiArrowLeftLine } from "@remixicon/react"

import { AnimatedNavButton } from "@/components/sales/animated-nav-button"
import { ROLE_ROUTES } from "@/lib/auth/role-routes"
import { useSession } from "@/lib/auth/session-context"

// A dark rainbow, not a grayscale one: the same six hues as SalesHubButton
// (rose, orange, yellow, green, cyan, indigo), each dropped to its own
// deep/muted shade. Grayscale read as "a dark outline", not "an effect" —
// this keeps the multicolour identity while suiting the calmer exit action.
const DARK_RAINBOW_RING = ["#7f1d1d", "#7c2d12", "#713f12", "#14532d", "#164e63", "#312e81", "#7f1d1d"]
const DARK_RAINBOW_BURST = ["#7f1d1d", "#7c2d12", "#713f12", "#14532d", "#164e63", "#312e81"]

/**
 * The way back to a role dashboard, shown only inside the Sales Hub — the
 * mirror image of SalesHubButton, which hides itself in exactly this slot
 * for the same reason: a door back to where you already are is dead weight
 * in the header everywhere else. Same `AnimatedNavButton` underneath; this
 * component is only the route/session check and the dark-rainbow palette.
 *
 * `bg-primary`/`text-primary-foreground` — the same named tokens the
 * shadcn `default` button variant itself reads from — rather than a
 * hardcoded colour: they happen to render near-black on near-white in this
 * theme, but naming them means a theme change carries this button along.
 *
 * Destination is computed from the person's role, not from browser history,
 * which is empty on a fresh tab and wrong after a refresh. Shown whenever
 * the route is under /sales and the session has resolved, regardless of
 * salesRole — if you are on the page at all, you need a way back.
 */
export function BackToDashboardButton() {
  const pathname = usePathname()
  const { user } = useSession()
  if (!pathname.startsWith("/sales") || !user) return null

  return (
    <AnimatedNavButton
      href={ROLE_ROUTES[user.role]}
      ariaLabel="Back to your dashboard"
      label="Dashboard"
      icon={RiArrowLeftLine}
      ringGradientStops={DARK_RAINBOW_RING}
      pillClassName="bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(23,25,28,0.2)] group-hover:bg-primary/80"
      burstColors={DARK_RAINBOW_BURST}
    />
  )
}
