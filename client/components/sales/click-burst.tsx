"use client"

import { RiStarFill } from "@remixicon/react"

// Six points around a circle, not a random scatter — a random spread reads
// as noise, a ring reads as a burst. 90 first so one particle always fires
// straight up, the direction a click most wants to celebrate toward.
const ANGLES = [90, 150, 210, 270, 330, 30]
const RADIUS = 24

/**
 * A one-shot particle burst, remounted (via the caller's `key`) on every
 * click so rapid repeat clicks each get their own fresh burst instead of
 * fighting over one animation's state — the same reason the project's
 * `rise-in`/`fade-in` entrance motion is keyframes rather than transitions.
 *
 * Each particle is two nested spans: an outer one that statically centres
 * it on the button (a plain `translate(-50%,-50%)`), and an inner one that
 * runs the `pop-particle` keyframe (`app/globals.css`). Kept separate
 * because a single element can only hold one `transform` at a time — baking
 * the static centring into the same value the keyframe animates would have
 * the animation's `translate()` overwrite it outright, the same bug the
 * SalesHubButton ring already had to route around once.
 */
export function ClickBurst({ colors }: { colors: string[] }) {
  return (
    <span className="pointer-events-none absolute inset-0" aria-hidden>
      {ANGLES.map((deg, i) => {
        const rad = (deg * Math.PI) / 180
        const tx = Math.cos(rad) * RADIUS
        // Screen Y grows downward; negate so 90deg pops upward, not down.
        const ty = -Math.sin(rad) * RADIUS
        return (
          <span key={deg} className="absolute top-1/2 left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2">
            <RiStarFill
              className="pop-particle size-2.5 motion-reduce:hidden"
              style={
                {
                  color: colors[i % colors.length],
                  animationDelay: `${i * 25}ms`,
                  "--tx": `${tx}px`,
                  "--ty": `${ty}px`,
                } as React.CSSProperties
              }
            />
          </span>
        )
      })}
    </span>
  )
}
