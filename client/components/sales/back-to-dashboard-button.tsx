"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { RiArrowLeftLine } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { ROLE_ROUTES } from "@/lib/auth/role-routes"
import { useSession } from "@/lib/auth/session-context"

/**
 * The way back to a role dashboard, shown only inside the Sales Hub — the
 * mirror image of SalesHubButton, which hides itself in exactly this slot
 * for the same reason: a door back to where you already are is dead weight
 * in the header everywhere else.
 *
 * Destination is computed from the person's role, not from browser history,
 * which is empty on a fresh tab and wrong after a refresh. Shown whenever
 * the route is under /sales and the session has resolved, regardless of
 * salesRole — if you are on the page at all, you need a way back.
 *
 * `variant="default"` rather than a hardcoded black — the shadcn `primary`
 * token happens to render near-black on near-white text in this theme,
 * which is the exact contrast asked for, but naming it means a theme change
 * carries this button along rather than leaving it behind.
 */
export function BackToDashboardButton() {
  const pathname = usePathname()
  const { user } = useSession()
  if (!pathname.startsWith("/sales") || !user) return null

  return (
    <Button
      nativeButton={false}
      variant="default"
      size="sm"
      className="gap-1.5 rounded-full px-3.5"
      render={<Link href={ROLE_ROUTES[user.role]} />}
    >
      <RiArrowLeftLine className="size-3.5" aria-hidden />
      Dashboard
    </Button>
  )
}
