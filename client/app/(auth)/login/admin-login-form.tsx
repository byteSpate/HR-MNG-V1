"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { loginAdmin } from "@/lib/api/auth"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import { nextFromSearch, postLoginPath } from "@/lib/auth/return-to"
import { RiLockLine, RiMailLine } from "@remixicon/react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { AUTH_INPUT, AUTH_INPUT_WITH_ICON, AuthError, AuthField, AuthSubmit } from "../auth-form-ui"

export function AdminLoginForm() {
  const router = useRouter()
  const { setSession } = useSession()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const { accessToken, user } = await loginAdmin(email, password)
      setSession(accessToken, user)
      // The page they first asked for, if their role may open it; otherwise
      // their own dashboard. A temporary password is replaced first, and the
      // remembered page is carried through that screen.
      router.push(postLoginPath(user, nextFromSearch(window.location.search)))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <AuthField label="Work email" htmlFor="admin-email" icon={RiMailLine}>
        <Input
          id="admin-email"
          type="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          className={cn(AUTH_INPUT, AUTH_INPUT_WITH_ICON)}
        />
      </AuthField>

      <AuthField label="Password" htmlFor="admin-password" icon={RiLockLine}>
        <PasswordInput
          id="admin-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          className={cn(AUTH_INPUT, AUTH_INPUT_WITH_ICON)}
        />
      </AuthField>

      {error ? <AuthError>{error}</AuthError> : null}

      <AuthSubmit submitting={submitting} label="Sign in" pendingLabel="Signing in…" />

      <p className="text-center text-[11.5px] leading-[1.6] text-[#5F6B7C]">
        Administrator accounts sign in with a work email. Staff use their employee ID on the other
        tab.
      </p>
    </form>
  )
}
