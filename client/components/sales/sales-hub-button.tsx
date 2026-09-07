"use client"

import Link from "next/link"
import { RiBuilding2Line } from "@remixicon/react"

import { useSession } from "@/lib/auth/session-context"

const RAINBOW =
  "bg-[conic-gradient(from_0deg,#f43f5e,#f97316,#eab308,#22c55e,#06b6d4,#6366f1,#d946ef,#f43f5e)]"

/**
 * The one entry point into the Sales Hub, in the header's icon cluster next
 * to the notification bell.
 *
 * Was a card in the page body; moved here because a card that far down the
 * page went unnoticed. The rainbow ring is a real conic-gradient rather than
 * a flat colour — a crisp edge (the "outline") plus a blurred halo behind it
 * (the "glow"), both rotating slowly. The rotation is what makes it register
 * as something to look at rather than one more grey icon; motion-reduce
 * freezes it rather than removing it, so the ring stays visible either way.
 *
 * Self-gated, the same way NotificationBell and HelpTrigger already are:
 * renders nothing for anyone without hub access, rather than a disabled
 * button advertising a room they cannot enter. One check, every dashboard —
 * a Super Admin passes without a salesRole, exactly as requireSales does
 * server-side; everyone else needs a granted salesRole.
 */
export function SalesHubButton() {
  const { user } = useSession()
  const canEnter = !!user && (user.role === "SUPER_ADMIN" || !!user.salesRole)
  if (!canEnter) return null

  return (
    <Link
      href="/sales"
      aria-label="Open Sales Hub"
      title="Sales Hub"
      className="group relative grid size-8.5 shrink-0 place-items-center rounded outline-none"
    >
      <span
        aria-hidden
        className={`absolute -inset-1.5 rounded-md ${RAINBOW} opacity-70 blur-[6px] transition-opacity duration-150 ease-out animate-[spin_5s_linear_infinite] group-hover:opacity-100 motion-reduce:animate-none`}
      />
      <span
        aria-hidden
        className={`absolute -inset-0.5 rounded-md ${RAINBOW} animate-[spin_5s_linear_infinite] motion-reduce:animate-none`}
      />
      <span className="relative grid size-8.5 place-items-center rounded bg-white text-[#17191C] shadow-sm transition-transform duration-150 ease-out-quint group-hover:scale-105 group-active:scale-95 group-focus-visible:ring-2 group-focus-visible:ring-[#17191C]/50 motion-reduce:transition-none">
        <RiBuilding2Line className="size-4" />
      </span>
    </Link>
  )
}
