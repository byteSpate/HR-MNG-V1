"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { RiKey2Line, RiLockLine, RiShieldKeyholeLine } from "@remixicon/react"

import { changePassword as apiChangePassword } from "@/lib/api/auth"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import { nextFromSearch, postLoginPath } from "@/lib/auth/return-to"
import { PasswordInput } from "@/components/ui/password-input"
import { cn } from "@/lib/utils"

import {
  AUTH_INPUT,
  AUTH_INPUT_WITH_ICON,
  AuthError,
  AuthField,
  AuthNotice,
  AuthSubmit,
  PasswordStrengthMeter,
} from "../auth-form-ui"

/** Matches `changePasswordSchema` on the server, which refuses anything shorter. */
const MIN_LENGTH = 8

export function ChangePasswordForm() {
  const router = useRouter()
  const { user, accessToken, status, setSession } = useSession()
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Not one of proxy.ts's protected prefixes — this route has to be reachable
  // the instant a forced redirect fires, before the refresh cookie the proxy
  // checks is necessarily readable. The client-side guard is what actually
  // keeps a signed-out visitor off it.
  if (status === "unauthenticated") {
    router.replace("/login")
    return null
  }

  // This screen serves two different arrivals: a forced first sign-in
  // redirect (no context of its own — the person landed here straight off
  // the login form) and a voluntary visit from an account-only profile that
  // already has a working password. Only the first one needs explaining.
  const forced = user?.mustChangePassword ?? false

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!accessToken || !user) return
    setError(null)
    setSubmitting(true)
    try {
      const result = await apiChangePassword(accessToken, currentPassword, newPassword)
      setSession(result.accessToken, result.user)
      // The page they were heading to before this screen, if their role may open it.
      router.push(postLoginPath(result.user, nextFromSearch(window.location.search)))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid gap-4">
      {forced ? (
        <AuthNotice icon={<RiShieldKeyholeLine />} title="Finish setting up your account">
          <p>
            You signed in with a temporary password. Choose a permanent one — only you will know
            it — and it replaces the temporary one immediately.
          </p>
        </AuthNotice>
      ) : null}

      <form onSubmit={handleSubmit} className="grid gap-4">
        <AuthField
          label={forced ? "Temporary password" : "Current password"}
          htmlFor="current-password"
          icon={RiKey2Line}
          hint={forced ? "The one-time password from your HR admin's email." : undefined}
        >
          <PasswordInput
            id="current-password"
            placeholder="••••••••"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            required
            className={cn(AUTH_INPUT, AUTH_INPUT_WITH_ICON)}
          />
        </AuthField>

        <div className="grid gap-1.5">
          <AuthField
            label="New password"
            htmlFor="new-password"
            icon={RiLockLine}
            hint={`At least ${MIN_LENGTH} characters. Use the eye to check it before you commit to it.`}
          >
            <PasswordInput
              id="new-password"
              placeholder="••••••••"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={MIN_LENGTH}
              required
              className={cn(AUTH_INPUT, AUTH_INPUT_WITH_ICON)}
            />
          </AuthField>
          <PasswordStrengthMeter password={newPassword} />
        </div>

        {error ? <AuthError>{error}</AuthError> : null}

        <AuthSubmit submitting={submitting} label="Set new password" pendingLabel="Saving…" />
      </form>
    </div>
  )
}
