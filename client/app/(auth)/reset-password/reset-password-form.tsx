"use client"

import { useState } from "react"
import Link from "next/link"
import { RiCheckboxCircleLine, RiLockLine } from "@remixicon/react"

import { resetPassword } from "@/lib/api/auth"
import { ApiError } from "@/lib/api/client"
import { PasswordInput } from "@/components/ui/password-input"
import { cn } from "@/lib/utils"

import {
  AUTH_INPUT,
  AUTH_INPUT_WITH_ICON,
  AUTH_LINK,
  AuthError,
  AuthField,
  AuthNotice,
  AuthSubmit,
} from "../auth-form-ui"

/** Matches `resetPasswordSchema` on the server, which refuses anything shorter. */
const MIN_LENGTH = 8

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  // A 400 is always the token being unusable, and the fix for every one of the
  // three is the same: get a fresh link. A network blip is not, so the offer
  // to start over is attached to this rather than to `error`.
  const [tokenSpent, setTokenSpent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await resetPassword(token, password)
      setDone(true)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
        setTokenSpent(err.status === 400)
      } else {
        setError("Something went wrong. Please try again.")
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="grid gap-4">
        <AuthNotice icon={<RiCheckboxCircleLine />} title="Your password is set">
          {/*
            The sign-out is not a footnote. `resetPassword` calls
            revokeAllUserTokens, so a phone that was signed in yesterday is
            signed out now, and someone who does not expect that reads it as
            the reset having broken something.
          */}
          <p>
            Every device that was signed in has been signed out, on purpose. Anyone who had reached
            your account is out of it now.
          </p>
          <p>Sign in again with the password you just chose.</p>
        </AuthNotice>

        <Link
          href="/login"
          className="flex h-11 w-full items-center justify-center rounded-lg bg-ink text-body font-bold text-white transition-transform hover:bg-ink-strong active:translate-y-px motion-reduce:transition-none"
        >
          Go to sign in
        </Link>
      </div>
    )
  }

  // An early return rather than an error under the field. Retyping cannot
  // rescue a token the server has rejected, so leaving the form up would be
  // offering a button that is guaranteed to fail.
  if (tokenSpent) {
    return (
      <div className="grid gap-4">
        <AuthError>{error}</AuthError>
        <p className="text-center text-caption text-ink-muted">
          Reset links are single use and last an hour.{" "}
          <Link href="/forgot-password" className={AUTH_LINK}>
            Request a new one
          </Link>
          .
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <AuthField
        label="New password"
        htmlFor="new-password"
        icon={RiLockLine}
        // Stated before it is typed rather than after it is rejected. This
        // link is single-use, so a password the server refuses costs a whole
        // round trip through the inbox.
        hint={`At least ${MIN_LENGTH} characters. Use the eye to check it before you commit to it.`}
      >
        <PasswordInput
          id="new-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          autoFocus
          required
          className={cn(AUTH_INPUT, AUTH_INPUT_WITH_ICON)}
        />
      </AuthField>

      {error ? <AuthError>{error}</AuthError> : null}

      <AuthSubmit submitting={submitting} label="Set new password" pendingLabel="Saving…" />
    </form>
  )
}
