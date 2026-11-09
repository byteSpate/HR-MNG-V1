"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import type { TimeClockState } from "@/lib/api/types"

/**
 * The ticking display is **seeded from the server's instant**, never from
 * `new Date()`.
 *
 * Lateness is decided server-side against the shift. A browser clock four
 * minutes fast would show "09:14, you're on time" while the server records
 * 09:17 and flags a late arrival the UI promised would not happen. What ticks
 * locally is the *elapsed* time since the payload arrived, added to the
 * server's own reading.
 */
function useServerClock(serverNow: string): Date {
  // Seeded with the server's own instant, so the first paint — including the
  // server render — is that value exactly, with no hydration mismatch and no
  // clock read during render.
  const [now, setNow] = useState(() => new Date(serverNow))

  useEffect(() => {
    const offset = new Date(serverNow).getTime() - Date.now()
    const tick = () => setNow(new Date(Date.now() + offset))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [serverNow])

  return now
}

const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null

export function TimeClockCard({
  state,
  pending,
  error,
  onCheckIn,
  onCheckOut,
}: {
  state: TimeClockState
  pending: boolean
  error: string | null
  onCheckIn: () => void
  onCheckOut: () => void
}) {
  const now = useServerClock(state.serverNow)
  const checkedInAt = clock(state.checkIn)

  return (
    <div className="flex min-w-0 flex-col gap-3.5 rounded-md bg-linear-to-br from-ink to-ink-strong p-4 text-white sm:p-5.5">
      <div className="flex items-center justify-between">
        <div className="text-body-sm font-semibold text-white/75">Time clock</div>
        <span
          className="rounded px-2.5 py-0.5 text-caption font-bold"
          style={{ background: state.checkedIn ? "#2FA75C" : "rgba(255,255,255,0.18)" }}
        >
          {state.checkedIn ? "Checked in" : "Checked out"}
        </span>
      </div>

      <div>
        <div className="font-heading text-stat font-bold tracking-tight tabular-nums">
          {now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}
        </div>
        <div className="mt-0.5 text-caption text-white/65">
          {state.detail
            ? state.detail
            : checkedInAt
              ? `Checked in at ${checkedInAt}`
              : "You have not checked in yet"}
        </div>
      </div>

      {error ? <div className="text-caption font-semibold text-warning-line">{error}</div> : null}

      <Button
        disabled={pending || (!state.canCheckIn && !state.canCheckOut)}
        onClick={state.canCheckOut ? onCheckOut : onCheckIn}
        // `hover:bg-white/90` is load-bearing, not decoration. The default
        // variant ships `hover:bg-primary/80`, and passing `bg-white` alone
        // leaves that untouched — so on hover the button turned near-black
        // behind near-black text and the label vanished. The same trap
        // `avatar-upload.tsx` documents: a base colour here does not override
        // a hover colour there.
        //
        // The previous `hover:brightness-[1.06]` could never have helped:
        // white is already at full brightness, so it was a no-op sitting
        // where a real hover state was needed.
        className="h-auto rounded-md bg-white px-3 py-3 text-sm font-bold text-ink transition-[background-color,transform] duration-150 ease-out hover:bg-white/90 active:translate-y-px disabled:opacity-50 motion-reduce:transition-none"
      >
        {pending ? "Saving…" : state.canCheckOut ? "Check out" : "Check in"}
      </Button>

      <div className="flex justify-between gap-3 border-t border-white/15 pt-3 text-xs text-white/70">
        <span className="truncate">{state.shift}</span>
        {/* Was an em-dash standing in for "no hours yet", which reads as a
            missing value rather than a real state. */}
        <span className="shrink-0">
          {state.hoursToday === null ? "Not started" : `${state.hoursToday}h today`}
        </span>
      </div>
    </div>
  )
}
