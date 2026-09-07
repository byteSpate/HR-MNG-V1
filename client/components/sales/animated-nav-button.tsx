"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { RemixiconComponentType } from "@remixicon/react"

import { ClickBurst } from "@/components/sales/click-burst"

// Real navigation is a full route-group swap, which Next.js completes well
// under the burst's 520ms — the button (and the burst inside it) was gone
// from the DOM before it had a chance to paint. Holding the actual
// navigation back by this long lets the burst register first; short enough
// that it never reads as latency, per Emil Kowalski's 100-160ms "immediate
// feedback" bracket.
const NAVIGATE_DELAY_MS = 160

/**
 * The animated pill behind both SalesHubButton and BackToDashboardButton —
 * previously two near-identical copies of this exact markup, which is how
 * the timer leak below ended up in both places at once. Each caller decides
 * *whether* to render (its own eligibility/route check) and *where to*;
 * this owns the ring, the burst, the click handling and the hover state.
 *
 * - A plain left-click is intercepted: it fires the burst, then defers the
 *   real navigation by `NAVIGATE_DELAY_MS` — skipped entirely under
 *   `prefers-reduced-motion`, where the burst never renders anyway, so
 *   there is nothing to wait for. A modified click (middle-click,
 *   ctrl/cmd-click, shift-click) is left alone, so "open in a new tab"
 *   keeps working exactly as a link should.
 * - Repeated clicks clear the previous timer before scheduling a new one,
 *   rather than leaking it — the bug the two original copies both had.
 * - The label collapses to icon-only below `sm`, alongside three other
 *   fixed-width header controls on a route that also has Help; at 320px
 *   that row does not have room for a labelled pill on top of them.
 * - Hover lifts 2px, matching the project's documented hover vocabulary
 *   (`docs/features/ui.md`: "a 1–2px lift plus a tinted shadow") rather
 *   than a bespoke distance.
 */
export function AnimatedNavButton({
  href,
  ariaLabel,
  label,
  icon: Icon,
  ringGradientStops,
  pillClassName,
  burstColors,
}: {
  href: string
  ariaLabel: string
  label: string
  icon: RemixiconComponentType
  /** Full conic-gradient colour-stop list, first and last matching so the
      loop closes seamlessly (e.g. `["#f43f5e", "#f97316", …, "#f43f5e"]`). */
  ringGradientStops: string[]
  /** Background + text colour classes for the pill itself. */
  pillClassName: string
  burstColors: string[]
}) {
  const router = useRouter()
  const [burstKey, setBurstKey] = useState(0)
  const navigateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (navigateTimer.current) clearTimeout(navigateTimer.current)
    }
  }, [])

  function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    event.preventDefault()

    if (navigateTimer.current) clearTimeout(navigateTimer.current)

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduceMotion) {
      router.push(href)
      return
    }

    setBurstKey((k) => k + 1)
    navigateTimer.current = setTimeout(() => router.push(href), NAVIGATE_DELAY_MS)
  }

  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      onClick={handleClick}
      className="group relative isolate inline-flex shrink-0 outline-offset-2 focus-visible:outline-2 focus-visible:outline-[#17191C]/60"
    >
      {/* The clipped ring frame. Centred, fixed-size square well past the
          pill's own footprint — large enough that rotating it never opens a
          gap at the pill's corners — with the spin isolated to an inner
          element so the animation's `transform: rotate()` cannot clobber
          this one's centring translate. The margin is an outward `-inset`,
          not inward padding, so the pill (not this frame) is what
          establishes the button's size. */}
      <span aria-hidden className="absolute -inset-[1.5px] overflow-hidden rounded-full">
        <span className="absolute top-1/2 left-1/2 size-44 -translate-x-1/2 -translate-y-1/2">
          <span
            className="absolute inset-0 animate-[spin_3s_linear_infinite] transition-[filter,animation-duration] duration-150 ease-out group-hover:[animation-duration:0.8s] group-active:brightness-125 group-active:saturate-150 motion-reduce:animate-none"
            style={{ backgroundImage: `conic-gradient(from 225deg, ${ringGradientStops.join(", ")})` }}
          />
        </span>
      </span>

      {/* The pill — in normal flow, so it is what sizes the Link. */}
      <span
        className={
          "relative z-10 flex h-8.5 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-bold transition-[background-color,transform,box-shadow] duration-150 ease-out-quint group-hover:-translate-y-0.5 group-hover:shadow-[0_10px_20px_-10px_rgba(23,25,28,0.45)] group-active:translate-y-0 group-active:scale-95 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0 " +
          pillClassName
        }
      >
        <Icon className="size-4" aria-hidden />
        <span className="hidden sm:inline">{label}</span>
      </span>

      {burstKey > 0 ? <ClickBurst key={burstKey} colors={burstColors} /> : null}
    </Link>
  )
}
