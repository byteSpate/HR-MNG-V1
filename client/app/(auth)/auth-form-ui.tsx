"use client"

import type { ReactNode } from "react"
import { RiErrorWarningLine, RiLoader4Line, type RemixiconComponentType } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { Heading } from "@/components/ds/heading"

/**
 * The furniture every signed-out form is built from.
 *
 * It started as the sign-in form's, shared by the staff and administrator
 * tabs, which differ only in which credential they take. Password reset added
 * two more forms with the same anatomy, so it moved up out of `login/`.
 */

/**
 * One input style, at a size meant to be typed into.
 *
 * The placeholder is #6B7789 rather than the usual near-invisible grey: on the
 * staff tab it carries the employee-code format (BS-EMP-00001), which is the
 * only place that format is stated.
 */
export const AUTH_INPUT =
  "h-11 w-full rounded-lg border-line bg-white text-body text-ink placeholder:text-ink-muted focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/12"

export function AuthField({
  label,
  htmlFor,
  icon: Icon,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  icon: RemixiconComponentType
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor} className="text-caption font-semibold text-ink-body">
        {label}
      </Label>
      {/* The icon sits on this wrapper rather than inside the control, because
          PasswordInput owns its own relative box for the reveal toggle.

          `z-10` is required, not decorative. That inner box is positioned and
          comes later in the DOM, so it paints over an earlier sibling: without
          it the password icon is drawn and then covered by the input's own
          white background, which is why only that field appeared to lack one. */}
      <div className="relative">
        <Icon
          className="pointer-events-none absolute top-1/2 left-3.5 z-10 size-4 -translate-y-1/2 text-ink-muted"
          aria-hidden
        />
        {children}
      </div>
      {hint ? <p className="text-caption leading-relaxed text-ink-muted">{hint}</p> : null}
    </div>
  )
}

/** Padding that clears the leading icon. Applied alongside AUTH_INPUT. */
export const AUTH_INPUT_WITH_ICON = "pl-10"

/**
 * A failed sign-in, stated the way the rest of the app states refusals.
 *
 * This was a bare red sentence. A wrong password is the single most common
 * thing that happens on this screen, so it gets a shape rather than a line of
 * loose text.
 */
export function AuthError({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border border-danger-line bg-danger-tint px-3.5 py-2.5 text-caption leading-relaxed font-semibold text-danger"
    >
      <RiErrorWarningLine className="mt-px size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  )
}

/** Every inline link on a signed-out screen, so they cannot drift apart. */
export const AUTH_LINK =
  "font-bold text-ink underline underline-offset-2 hover:text-ink-strong"

/**
 * The panel a form is replaced by once it has done its job.
 *
 * The icon is the same near-black as everything else rather than a success
 * green. Green would be a second accent on a screen that has exactly one, and
 * neither of the two things this reports is unambiguously good news: "a link
 * may be on its way" is a maybe, and "your password is set" comes with every
 * session being ended.
 *
 * `icon` is an element, not a component, unlike `AuthField` above. This module
 * is `"use client"`, and the reset page renders this one from a server
 * component when the link arrives with no token — a component is a function,
 * which cannot cross that boundary, while an element serialises. `tsc` and
 * eslint are both happy either way; the page 500s at request time.
 */
export function AuthNotice({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <div className="rounded-lg border border-line bg-white px-5 py-4.5">
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="shrink-0 text-ink [&>svg]:size-4.5">
          {icon}
        </span>
        <Heading level="section">{title}</Heading>
      </div>
      <div className="mt-2.5 grid gap-2.5 text-caption leading-relaxed text-ink-muted">
        {children}
      </div>
    </div>
  )
}

/**
 * The spinner is the one piece of motion on this screen, and it earns its
 * place: every one of these forms is a network round trip with no other sign
 * that it started.
 *
 * `pendingLabel` is required rather than defaulting to "Signing in…", which is
 * what it said while it lived under `login/`. Sending a reset link is not
 * signing in, and a default that is right for one caller and a lie for the
 * other three is worse than making each say what it is doing.
 */
/**
 * Four levels, cheapest-signal-first: length, then length again at a longer
 * threshold, then case variety, then a digit or symbol. Not a real entropy
 * estimate — just enough to tell "temp1234" from "a real passphrase" apart,
 * which is the whole job here.
 */
const STRENGTH_LEVELS = [
  { label: "Weak", color: "#B03A3A" },
  { label: "Fair", color: "#9A6B10" },
  { label: "Good", color: "#3D6FB4" },
  { label: "Strong", color: "#1E7A3C" },
] as const

function scorePassword(password: string): number {
  let score = 0
  if (password.length >= 8) score += 1
  if (password.length >= 12) score += 1
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1
  if (/[0-9]/.test(password) || /[^a-zA-Z0-9]/.test(password)) score += 1
  return score
}

/**
 * Live feedback while choosing a permanent password, not a gate — the
 * server's own `min(8)` is what actually blocks submission. This exists so
 * "at least 8 characters" isn't the only signal someone gets before they
 * commit to a password they'll be typing for months.
 *
 * Renders nothing for an empty field: an opinion about a password that has
 * not been typed yet is noise, not feedback.
 */
export function PasswordStrengthMeter({ password }: { password: string }) {
  if (password.length === 0) return null

  // At least one bar as soon as anything is typed — four grey bars next to
  // the word "Weak" would read as a contradiction.
  const filled = Math.max(scorePassword(password), 1)
  const level = STRENGTH_LEVELS[filled - 1]

  return (
    <div className="flex items-center gap-2.5 pt-0.5" aria-live="polite">
      <div className="flex flex-1 gap-1">
        {STRENGTH_LEVELS.map((_, i) => (
          <span
            key={i}
            aria-hidden
            className="h-1 flex-1 rounded-full transition-colors duration-200 ease-out-quint motion-reduce:transition-none"
            style={{ background: i < filled ? level.color : "#E4E9EF" }}
          />
        ))}
      </div>
      <span className="text-caption font-bold" style={{ color: level.color }}>
        {level.label}
      </span>
    </div>
  )
}

export function AuthSubmit({
  submitting,
  label,
  pendingLabel,
}: {
  submitting: boolean
  label: string
  pendingLabel: string
}) {
  return (
    <Button
      type="submit"
      disabled={submitting}
      className={cn(
        "h-11 w-full rounded-lg bg-ink text-body font-bold text-white",
        "hover:bg-ink-strong disabled:opacity-60"
      )}
    >
      {submitting ? (
        <>
          <RiLoader4Line className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          {pendingLabel}
        </>
      ) : (
        label
      )}
    </Button>
  )
}
