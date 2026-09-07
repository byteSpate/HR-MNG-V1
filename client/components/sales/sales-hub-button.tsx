"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { RiBuilding2Line } from "@remixicon/react"

import { ClickBurst } from "@/components/sales/click-burst"
import { useSession } from "@/lib/auth/session-context"

const RAINBOW = ["#f43f5e", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#6366f1"]

// Real navigation to /sales is a full route-group swap, which Next.js
// completes in well under the burst's 520ms — this button was gone from the
// DOM before the burst had a chance to paint. Holding the actual navigation
// back by this long lets the burst register first; short enough that it
// never reads as latency, per Emil Kowalski's 100-160ms "immediate
// feedback" bracket.
const NAVIGATE_DELAY_MS = 160

/**
 * The one entry point into the Sales Hub, in the header's icon cluster next
 * to the notification bell. Hidden while already inside the hub — see
 * `BackToDashboardButton`, which takes over the same slot there.
 *
 * The ring is an animated gradient **border**, not a spinning disc: the
 * pill's own white background covers everything except a 1.5px margin right
 * at its edge, and a big conic-gradient square rotates underneath, centred
 * and clipped to that same pill shape. Only the sliver in that margin is
 * ever visible, so what reads on screen is a band of colour continuously
 * chasing the button's actual outline — corners included — rather than a
 * rainbow pinwheel spinning from the centre. The margin is an outward
 * `-inset`, not inward padding, so the pill itself (not the clipped frame
 * around it) is what establishes the button's size — the frame is
 * `position: absolute` and contributes nothing to layout on its own, which
 * matters once ClickBurst needs to escape past the pill's edges below.
 * motion-reduce freezes the rotation but keeps the ring, so visibility
 * survives reduced motion too; hovering spins it noticeably faster, a
 * dial-up of the same motif rather than a second, unrelated hover effect.
 *
 * A plain click still hits an `<a href="/sales">` — a modified click
 * (middle-click, ctrl/cmd-click, shift-click) is left alone entirely, so
 * "open in a new tab" keeps working exactly as a link should. Only the
 * ordinary left click is intercepted, to fire the burst and give
 * `NAVIGATE_DELAY_MS` a chance to let it play before the route actually
 * changes underneath it.
 *
 * Self-gated, the same way NotificationBell and HelpTrigger already are:
 * renders nothing for anyone without hub access, rather than a disabled
 * button advertising a room they cannot enter. One check, every dashboard —
 * a Super Admin passes without a salesRole, exactly as requireSales does
 * server-side; everyone else needs a granted salesRole.
 */
export function SalesHubButton() {
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

  const canEnter = !!user && (user.role === "SUPER_ADMIN" || !!user.salesRole)
  if (!canEnter || pathname.startsWith("/sales")) return null

  function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    event.preventDefault()
    setBurstKey((k) => k + 1)
    navigateTimer.current = setTimeout(() => router.push("/sales"), NAVIGATE_DELAY_MS)
  }

  return (
    <Link
      href="/sales"
      aria-label="Open Sales Hub"
      onClick={handleClick}
      className="group relative isolate inline-flex shrink-0 outline-offset-2 focus-visible:outline-2 focus-visible:outline-[#17191C]/60"
    >
      {/* The clipped ring frame. Centred, fixed-size square well past the
          pill's own footprint — large enough that rotating it never opens a
          gap at the pill's corners — with the spin isolated to an inner
          element so the animation's `transform: rotate()` cannot clobber
          this one's centring translate. */}
      <span aria-hidden className="absolute -inset-[1.5px] overflow-hidden rounded-full">
        <span className="absolute top-1/2 left-1/2 size-44 -translate-x-1/2 -translate-y-1/2">
          <span className="absolute inset-0 animate-[spin_3s_linear_infinite] bg-[conic-gradient(from_225deg,#f43f5e,#f97316,#eab308,#22c55e,#06b6d4,#6366f1,#d946ef,#f43f5e)] transition-[filter,animation-duration] duration-150 ease-out group-hover:[animation-duration:0.8s] group-active:brightness-125 group-active:saturate-150 motion-reduce:animate-none" />
        </span>
      </span>

      {/* The pill — in normal flow, so it is what sizes the Link. */}
      <span className="relative z-10 flex h-8.5 items-center gap-1.5 rounded-full bg-white px-3.5 text-[12.5px] font-bold text-[#17191C] shadow-[0_1px_2px_rgba(23,25,28,0.06)] transition-[background-color,transform,box-shadow] duration-150 ease-out-quint group-hover:-translate-y-1 group-hover:scale-[1.03] group-hover:bg-[#F4F6F9] group-hover:shadow-[0_14px_26px_-12px_rgba(23,25,28,0.45)] group-active:translate-y-0 group-active:scale-95 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0 motion-reduce:group-hover:scale-100">
        <RiBuilding2Line className="size-4" aria-hidden />
        Sales Hub
      </span>

      {burstKey > 0 ? <ClickBurst key={burstKey} colors={RAINBOW} /> : null}
    </Link>
  )
}
