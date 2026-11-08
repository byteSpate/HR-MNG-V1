"use client"

import { useState } from "react"
import Link from "next/link"
import { RiMailLine, RiMailSendLine } from "@remixicon/react"

import { forgotPassword } from "@/lib/api/auth"
import { ApiError } from "@/lib/api/client"
import { Input } from "@/components/ui/input"
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

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("")
  // The address as it was when the request went out. Rendering `email` in the
  // confirmation would let the sentence change under the reader if the field
  // were still live behind it.
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const address = email.trim()
    try {
      await forgotPassword(address)
      setSentTo(address)
    } catch (err) {
      // The only failures that reach here are a malformed address or the API
      // being unreachable. A missing account is a 200, deliberately.
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (sentTo) {
    return (
      <div className="grid gap-4">
        <AuthNotice icon={<RiMailSendLine />} title="Check that inbox">
          {/*
            "If" is doing real work in this sentence and cannot be dropped for
            a warmer one. The server answers the same way for an address it has
            never seen, so promising delivery outright would be a claim the
            page has no basis for.
          */}
          <p>
            If <span className="font-semibold text-ink-body">{sentTo}</span> belongs to an account,
            a link to set a new password is on its way. It works once, and it stops working an hour
            after it was sent.
          </p>
          <p>
            Nothing arrived? Check the spam folder first. After that, your HR admin can confirm
            which address is on your record.
          </p>
        </AuthNotice>

        <button
          type="button"
          onClick={() => setSentTo(null)}
          className="text-center text-caption font-semibold text-ink-muted underline underline-offset-2 hover:text-ink"
        >
          Try a different address
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <AuthField
        label="Work email"
        htmlFor="reset-email"
        icon={RiMailLine}
        hint="Staff sign in with an employee ID, but the reset link goes to the email address on your record."
      >
        <Input
          id="reset-email"
          type="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          required
          className={cn(AUTH_INPUT, AUTH_INPUT_WITH_ICON)}
        />
      </AuthField>

      {error ? <AuthError>{error}</AuthError> : null}

      <AuthSubmit submitting={submitting} label="Send the reset link" pendingLabel="Sending…" />

      <p className="text-center text-caption text-ink-muted">
        Remembered it?{" "}
        <Link href="/login" className={AUTH_LINK}>
          Back to sign in
        </Link>
      </p>
    </form>
  )
}
