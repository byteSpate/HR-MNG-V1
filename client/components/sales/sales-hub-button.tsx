"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { RiBuilding2Line } from "@remixicon/react"

import { useSession } from "@/lib/auth/session-context"

/**
 * The one entry point into the Sales Hub, in the header's icon cluster next
 * to the notification bell. Hidden while already inside the hub — see
 * `BackToDashboardButton`, which takes over the same slot there.
 *
 * The ring is an animated gradient **border**, not a spinning disc: the
 * pill's own white background covers everything except a 1.5px gap right at
 * its edge, and a big conic-gradient square rotates underneath, centred and
 * clipped to that same pill shape. Only the sliver inside the gap is ever
 * visible, so what reads on screen is a band of colour continuously
 * chasing the button's actual outline — corners included — rather than a
 * rainbow pinwheel spinning from the centre. motion-reduce freezes the
 * rotation but keeps the ring, so visibility survives reduced motion too.
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
    <Link
      href="/sales"
      aria-label="Open Sales Hub"
      className="group relative isolate inline-flex shrink-0 overflow-hidden rounded-full p-[1.5px] outline-offset-2 focus-visible:outline-2 focus-visible:outline-[#17191C]/60"
    >
      {/* Centred, fixed-size square well past the pill's own footprint —
          large enough that rotating it never opens a gap at the pill's
          corners — with the spin isolated to an inner element so the
          animation's `transform: rotate()` cannot clobber this one's
          centring translate. */}
      <span aria-hidden className="absolute top-1/2 left-1/2 size-44 -translate-x-1/2 -translate-y-1/2">
        <span className="absolute inset-0 animate-[spin_3s_linear_infinite] bg-[conic-gradient(from_225deg,#f43f5e,#f97316,#eab308,#22c55e,#06b6d4,#6366f1,#d946ef,#f43f5e)] transition-[filter] duration-150 ease-out group-active:brightness-125 group-active:saturate-150 motion-reduce:animate-none" />
      </span>
      <span className="relative z-10 flex h-8.5 items-center gap-1.5 rounded-full bg-white px-3.5 text-[12.5px] font-bold text-[#17191C] transition-[background-color,transform] duration-150 ease-out-quint group-hover:bg-[#F4F6F9] group-active:scale-93 group-active:translate-y-px motion-reduce:transition-none">
        <RiBuilding2Line className="size-4" aria-hidden />
        Sales Hub
      </span>
    </Link>
  )
}
