"use client"

import { useEffect, useRef } from "react"
import { RiCompass3Line } from "@remixicon/react"

/**
 * The "4 — compass — 4" cluster, and the one piece of delight on this page.
 *
 * Why animate at all: a 404 is *rare*. The frequency test that kills animation
 * on a command palette (hundreds of opens a day) licenses it here — nobody
 * sees this often enough to grow tired of it. It is also the only honest
 * subject for motion on the page: a compass hunting for a bearing is what
 * being at the wrong address feels like.
 *
 * Physics rather than a keyframe, for two reasons. A spring keeps velocity
 * when its target moves, so a needle chasing the cursor never restarts from
 * zero the way a retriggered keyframe would. And the entrance is the same
 * mechanism as the tracking: the needle simply *starts* three-quarters of a
 * turn out and settles, so there is no separate intro animation to keep in
 * sync with the interactive one.
 *
 * Hand-rolled because no motion library is installed, and pulling one in for
 * a single page nobody should be visiting is the wrong trade.
 */

// Underdamped on purpose: the needle should overshoot slightly and swing
// back, the way a real compass does. Critical damping would read as a dial
// being *driven* to a position rather than finding one.
const STIFFNESS = 90
const DAMPING = 12
/** Degrees. Where the needle starts, so its entrance is a long unwind. */
const ENTRY_OFFSET = -280
/** Pixels. The counter-drift on the numerals — felt, not seen. */
const PARALLAX = 3
/** ms. Long enough for the unwind to read before the cursor takes over. */
const HANDOVER = 620

interface Spring {
  value: number
  velocity: number
  target: number
}

const spring = (value: number): Spring => ({ value, velocity: 0, target: value })

/**
 * One step of a damped spring. `dt` is clamped by the caller — an unclamped
 * dt after a tab switch integrates half a second in a single frame and throws
 * the needle clean off the dial.
 */
function step(s: Spring, dt: number) {
  const accel = -STIFFNESS * (s.value - s.target) - DAMPING * s.velocity
  s.velocity += accel * dt
  s.value += s.velocity * dt
}

const settled = (s: Spring) =>
  Math.abs(s.velocity) < 0.02 && Math.abs(s.value - s.target) < 0.02

/**
 * The shortest way round. Without this the needle takes the long route
 * whenever the cursor crosses due north — 359 degrees to 1 reads as a 358
 * degree spin instead of the 2 degree nudge it actually is.
 */
function shortestTurn(from: number, to: number) {
  const wrapped = ((((to - from) % 360) + 540) % 360) - 180
  return wrapped
}

const clamp1 = (n: number) => Math.max(-1, Math.min(1, n))

export function LostCompass() {
  const needleRef = useRef<HTMLSpanElement>(null)
  const leftRef = useRef<HTMLSpanElement>(null)
  const rightRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const needle = needleRef.current
    if (!needle) return

    // Reduced motion means gentler, not none — but a needle chasing the
    // pointer is exactly the vestibular trigger the preference exists for.
    // The numerals still fade in via .rise-in; only the physics stops.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    // A compass that follows a cursor has nothing to follow on a touch
    // screen. The entrance still runs; the tracking never starts.
    const canTrack = window.matchMedia("(hover: hover) and (pointer: fine)").matches

    const angle = spring(ENTRY_OFFSET)
    const driftX = spring(0)
    const driftY = spring(0)

    let frame = 0
    let last = performance.now()
    let running = false

    const draw = () => {
      needle.style.transform = `rotate(${angle.value.toFixed(2)}deg)`
      const x = driftX.value
      const y = driftY.value
      // Opposed offsets: the numerals lean away from the pointer while the
      // needle leans toward it, which is what sells the cluster as having
      // depth rather than as three things that happen to move.
      if (leftRef.current) {
        leftRef.current.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`
      }
      if (rightRef.current) {
        rightRef.current.style.transform = `translate(${(-x).toFixed(2)}px, ${y.toFixed(2)}px)`
      }
    }

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30)
      last = now

      // Retarget to the nearest equivalent angle every frame, so a moving
      // cursor never makes the needle unwind the wrong way.
      angle.target = angle.value + shortestTurn(angle.value, angle.target)
      step(angle, dt)
      step(driftX, dt)
      step(driftY, dt)
      draw()

      // Parking the loop when everything has settled is the difference
      // between a page that idles at zero and one that burns a core forever
      // on a dial nobody is touching.
      if (settled(angle) && settled(driftX) && settled(driftY)) {
        running = false
        return
      }
      frame = requestAnimationFrame(tick)
    }

    const start = () => {
      if (running) return
      running = true
      last = performance.now()
      frame = requestAnimationFrame(tick)
    }

    const onMove = (event: PointerEvent) => {
      const box = needle.getBoundingClientRect()
      const dx = event.clientX - (box.left + box.width / 2)
      const dy = event.clientY - (box.top + box.height / 2)

      // +90 because the glyph's own north points up, not right.
      angle.target = (Math.atan2(dy, dx) * 180) / Math.PI + 90

      const reach = Math.max(window.innerWidth, window.innerHeight) / 2
      driftX.target = clamp1(-dx / reach) * PARALLAX
      driftY.target = clamp1(-dy / reach) * PARALLAX
      start()
    }

    draw()
    // Settle to north first; only then start listening, so the entrance is
    // never cut short by a cursor that happened to be moving on load.
    angle.target = 0
    start()

    let listening = false
    const handover = window.setTimeout(() => {
      if (!canTrack) return
      window.addEventListener("pointermove", onMove, { passive: true })
      listening = true
    }, HANDOVER)

    return () => {
      window.clearTimeout(handover)
      if (listening) window.removeEventListener("pointermove", onMove)
      cancelAnimationFrame(frame)
    }
  }, [])

  // Two nested spans per numeral, deliberately. `.rise-in` animates transform
  // with `fill-mode: both`, and a CSS animation outranks an inline style in
  // the cascade — so the entrance would have permanently pinned
  // `transform: none` and silently eaten every parallax write. The outer span
  // owns the JS transform, the inner one owns the entrance, and they compose.
  return (
    <div
      aria-hidden
      className="mb-1 flex items-end gap-1.5 font-[family-name:var(--font-heading)] text-hero leading-none font-bold tracking-tight text-line select-none sm:text-giant"
    >
      <span ref={leftRef} className="inline-block will-change-transform">
        <span className="rise-in inline-block">4</span>
      </span>

      <span className="inline-flex items-center">
        <span className="rise-in inline-flex" style={{ animationDelay: "60ms" }}>
          <span ref={needleRef} className="inline-flex will-change-transform">
            <RiCompass3Line className="size-[0.72em] text-line-strong" />
          </span>
        </span>
      </span>

      <span ref={rightRef} className="inline-block will-change-transform">
        <span className="rise-in inline-block" style={{ animationDelay: "120ms" }}>
          4
        </span>
      </span>
    </div>
  )
}
