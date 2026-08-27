"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation } from "@tanstack/react-query"
import { RiCheckLine, RiMailLine } from "@remixicon/react"

import { confirmEmailChange } from "@/lib/api/auth"
import { ApiError } from "@/lib/api/client"
import { AuthNotice } from "../../auth-form-ui"
import { Button } from "@/components/ui/button"

/**
 * The final step, and the one that actually changes anything.
 *
 * A button rather than an automatic call on page load. Mail clients and
 * security scanners fetch links in the background to check them, and a `GET`
 * that applied the change would let a scanner complete somebody's email change
 * before they ever opened the message.
 */
export function ConfirmEmailChangeForm({ token }: { token: string }) {
  const [email, setEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const confirm = useMutation({
    mutationFn: () => confirmEmailChange(token),
    onSuccess: (r) => {
      setError(null)
      setEmail(r.email)
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again."),
  })

  if (email) {
    return (
      <div className="grid gap-4">
        <AuthNotice icon={<RiCheckLine />} title="Done — sign in with the new address">
          <p>
            Your account now signs in with <strong>{email}</strong>.
          </p>
          <p>
            Every device was signed out, including this one if you were using it. Your password has
            not changed.
          </p>
        </AuthNotice>
        <Button type="button" nativeButton={false} render={<Link href="/login" />}>
          Sign in
        </Button>
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <AuthNotice icon={<RiMailLine />} title="This is the last step">
        <p>
          Confirming makes this the address the account signs in with, and the address password
          resets are sent to.
        </p>
        <p>You will be signed out everywhere and will need to sign in again.</p>
      </AuthNotice>

      {error ? <p className="text-[12.5px] text-[#B03A3A]">{error}</p> : null}

      <Button type="button" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
        {confirm.isPending ? "Confirming…" : "Confirm this address"}
      </Button>
    </div>
  )
}
