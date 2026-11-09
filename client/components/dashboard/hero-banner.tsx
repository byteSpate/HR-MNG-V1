import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Heading } from "@/components/ds/heading"

/**
 * How far the stat grid lifts into the hero.
 *
 * The hero's bottom padding reserves this space, the grid pulls up by it, and
 * the loading skeleton repeats it. Those were three separate magic numbers
 * that had to agree by hand, so changing the hero's padding silently broke the
 * overlap. They now read one value.
 */
export const HERO_OVERLAP_PX = 52

/** Breathing room between the hero's own copy and the cards that overlap it. */
const HERO_CLEARANCE_PX = 26

export function HeroBanner({
  kicker,
  heading,
  sub,
  cta,
  ctaHref,
  today,
}: {
  kicker: string
  heading: string
  sub: string
  cta: string
  /** When given, the CTA navigates. Without it the button is decorative. */
  ctaHref?: string
  /** Formatted by the caller, which owns the one clock read on this page. */
  today: string
}) {
  return (
    <div
      className="relative overflow-hidden rounded-b-md px-4.5 pt-6 text-white sm:px-7.5 sm:pt-7.5"
      style={{
        paddingBottom: HERO_OVERLAP_PX + HERO_CLEARANCE_PX,
        background: "linear-gradient(120deg, #17191C 0%, #33373D 55%, #17191C 100%)",
      }}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 text-caption font-bold tracking-[1.2px] text-line-strong uppercase">
            {kicker}
          </div>
          <Heading level="display" className="mb-1.5">
            {heading}
          </Heading>
          {/* Two facts, two lines. They were joined with a middle dot, which
              made the date look like part of the sentence after it. */}
          <div className="text-body-sm text-white/75">{sub}</div>
          <div className="mt-0.5 text-caption text-white/55">{today}</div>
        </div>

        {/* `Button` here has no `asChild`, so the link wraps it rather than
            replacing it. */}
        {ctaHref ? (
          <Link href={ctaHref} className="shrink-0">
            <Button className="h-auto rounded-md bg-white px-4 py-2.5 text-body-sm font-bold text-ink hover:bg-surface-sunken">
              {cta}
            </Button>
          </Link>
        ) : (
          <Button className="h-auto shrink-0 rounded-md bg-white px-4 py-2.5 text-body-sm font-bold text-ink hover:bg-surface-sunken">
            {cta}
          </Button>
        )}
      </div>
    </div>
  )
}
