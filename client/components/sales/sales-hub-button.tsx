"use client"

import { usePathname } from "next/navigation"
import { RiBuilding2Line } from "@remixicon/react"

import { AnimatedNavButton } from "@/components/sales/animated-nav-button"
import { useSession } from "@/lib/auth/session-context"

const RAINBOW_RING = ["#f43f5e", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#6366f1", "#d946ef", "#f43f5e"]
const RAINBOW_BURST = ["#f43f5e", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#6366f1"]

/**
 * The one entry point into the Sales Hub, in the header's icon cluster next
 * to the notification bell. Hidden while already inside the hub — see
 * `BackToDashboardButton`, which takes over the same slot there. The
 * animated ring/burst/click behaviour lives in `AnimatedNavButton`; this
 * component is only the eligibility check and the rainbow palette.
 *
 * Self-gated, the same way NotificationBell and HelpTrigger already are:
 * renders nothing for anyone without hub access, rather than a disabled
 * button advertising a room they cannot enter. One check, every dashboard —
 * a Super Admin passes without a salesRole, exactly as requireSales does
 * server-side; everyone else needs a granted salesRole.
 */
export function SalesHubButton() {
  const pathname = usePathname()
  const { user } = useSession()
  const canEnter = !!user && (user.role === "SUPER_ADMIN" || !!user.salesRole)
  if (!canEnter || pathname.startsWith("/sales")) return null

  return (
    <AnimatedNavButton
      href="/sales"
      ariaLabel="Open Sales Hub"
      label="Sales Hub"
      icon={RiBuilding2Line}
      ringGradientStops={RAINBOW_RING}
      pillClassName="bg-white text-[#17191C] shadow-[0_1px_2px_rgba(23,25,28,0.06)] group-hover:bg-[#F4F6F9]"
      burstColors={RAINBOW_BURST}
    />
  )
}
