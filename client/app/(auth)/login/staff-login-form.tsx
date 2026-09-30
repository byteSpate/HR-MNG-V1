"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { loginStaff } from "@/lib/api/auth"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import { nextFromSearch, postLoginPath } from "@/lib/auth/return-to"
import { RiIdCardLine, RiLockLine } from "@remixicon/react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { AUTH_INPUT, AUTH_INPUT_WITH_ICON, AuthError, AuthField, AuthSubmit } from "../auth-form-ui"

export function StaffLoginForm() {
  const router = useRouter()
  const { setSession } = useSession()
  const [employeeId, setEmployeeId] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      // Trim as well as uppercase: employee codes are handed out by email and
      // arrive pasted with stray whitespace, which the server matches exactly.
      const { accessToken, user } = await loginStaff(employeeId.trim(), password)
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
      <AuthField label="Employee ID" htmlFor="employee-id" icon={RiIdCardLine}>
        <Input
          id="employee-id"
          type="text"
          placeholder="BS-EMP-00001"
          value={employeeId}
          // The field is styled `uppercase`, but text-transform only changes
          // what is painted. Without this the value sent stays as typed and a
          // lowercase code fails an exact-match lookup while looking correct.
          onChange={(e) => setEmployeeId(e.target.value.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="username"
          required
          className={cn(AUTH_INPUT, AUTH_INPUT_WITH_ICON, "uppercase tracking-wide")}
        />
      </AuthField>

      <AuthField label="Password" htmlFor="employee-password" icon={RiLockLine}>
        <PasswordInput
          id="employee-password"
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
        First time signing in? Use the temporary ID and password your HR team sent you. You&rsquo;ll
        be asked to set a new password.
      </p>
    </form>
  )
}
