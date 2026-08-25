"use client"

import * as React from "react"

import { cn, parseDateString } from "@/lib/utils"
import { Input } from "@/components/ui/input"

/**
 * The one date field in this app.
 *
 * This is the browser's own date input, not a hand-built calendar. That is a
 * deliberate reversal: an earlier version of this file wrapped a `Calendar` in
 * a `Popover`, which meant this app had two different date experiences — this
 * one, and the plain `<input type="date">` used by roughly twenty other fields
 * (the holiday editor, the journal entry, every accounting range filter). The
 * native control is the one that was already everywhere and already better at
 * the things that were asked for:
 *
 * - a month **and** year dropdown, so a date of birth in 1990 is two clicks
 *   rather than several hundred
 * - picking a date closes the picker
 * - Clear and Today shortcuts, for free
 * - you can type the date instead of hunting for it
 * - it is the platform's own widget, so it is keyboard- and screen-reader
 *   correct without us maintaining that
 *
 * Values are the `YYYY-MM-DD` strings the API speaks, which is also exactly
 * what this input reads and writes — no `Date` round-trip, which is where
 * timezone bugs get in.
 *
 * **What the native control cannot do** is grey out scattered individual days,
 * which a custom calendar can. `min`/`max` cover contiguous bounds. For
 * anything else — "not a holiday", "not a weekly off" — pass `unavailable`:
 * the date is rejected on selection with the reason shown underneath. That is
 * arguably the better trade anyway; a greyed-out day tells the user they
 * cannot have it but never why.
 */
export function DatePicker({
  value,
  onChange,
  min,
  max,
  disabled = false,
  unavailable,
  id,
  className,
}: {
  /** `YYYY-MM-DD`, or empty for no selection. */
  value: string
  onChange: (value: string) => void
  /** `YYYY-MM-DD`. Contiguous bounds the browser enforces itself. */
  min?: string
  max?: string
  /** Disables the field — it is unavailable, rather than its dates being. */
  disabled?: boolean
  /**
   * Returns why this specific date cannot be used, or null if it can. Checked
   * on selection, because the native picker has no way to grey a day out.
   */
  unavailable?: (date: Date) => string | null
  id?: string
  className?: string
}) {
  const [rejected, setRejected] = React.useState<string | null>(null)

  // A bound that moved under a value that no longer satisfies it — pick an end
  // date, then move the start past it — is the caller's to resolve. This only
  // reports the reason for a date the user just chose.
  function handleChange(next: string) {
    if (!next) {
      setRejected(null)
      onChange(next)
      return
    }
    const reason = unavailable?.(parseDateString(next)) ?? null
    setRejected(reason)
    // Rejected dates are not committed. Committing and then complaining would
    // let a submit through on a date the form has already objected to.
    if (!reason) onChange(next)
  }

  return (
    <div className={cn("w-full", className)}>
      <Input
        id={id}
        type="date"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        aria-invalid={rejected ? true : undefined}
        onChange={(e) => handleChange(e.target.value)}
      />
      {rejected ? (
        <p className="mt-1.5 text-[11.5px] leading-snug font-medium text-[#B03A3A]">{rejected}</p>
      ) : null}
    </div>
  )
}
