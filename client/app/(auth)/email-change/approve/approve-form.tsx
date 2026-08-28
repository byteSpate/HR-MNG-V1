"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation } from "@tanstack/react-query"
import { RiCheckLine, RiShieldKeyholeLine } from "@remixicon/react"

import { approveEmailChange, cancelEmailChange } from "@/lib/api/auth"
import { ApiError } from "@/lib/api/client"
import { AUTH_LINK, AuthNotice } from "../../auth-form-ui"
import { Button } from "@/components/ui/button"

/**
 * Two buttons, and the refusing one is not an afterthought.
 *
 * This page is read by two different people. One asked for the change and is
 * confirming it. The other did *not*, and is looking at evidence that somebody
 * has their session — for them "No, this wasn't me" is the most important
 * control on the page, so it gets equal weight and says what it will do.
 *
 * Refusing revokes every session, which is why it is worth pressing rather
 * than just closing the tab.
 */
export function ApproveEmailChangeForm({ token }: { token: string }) {
  const [done, setDone] = useState<"approved" | "cancelled" | null>(null)
  const [newEmail, setNewEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")

  const approve = useMutation({
    mutationFn: () => approveEmailChange(token),
    onSuccess: (r) => {
      setError(null)
      setNewEmail(r.newEmail)
      setDone("approved")
    },
    onError: fail,
  })

  const refuse = useMutation({
    mutationFn: () => cancelEmailChange(token),
    onSuccess: () => {
      setError(null)
      setDone("cancelled")
    },
    onError: fail,
  })

  const pending = approve.isPending || refuse.isPending

  if (done === "approved") {
    return (
      <div className="grid gap-4">
        <AuthNotice icon={<RiCheckLine />} title="Approved — one step left">
          <p>
            We have emailed <strong>{newEmail}</strong> to check that inbox works. Open it and
            confirm, and the change is done.
          </p>
          <p>Your address has not changed yet. If you never confirm, it stays as it is.</p>
        </AuthNotice>
        <p className="text-center text-[12px] text-[#5F6B7C]">
          <Link href="/login" className={AUTH_LINK}>
            Back to sign in
          </Link>
        </p>
      </div>
    )
  }

  if (done === "cancelled") {
    return (
      <div className="grid gap-4">
        <AuthNotice icon={<RiShieldKeyholeLine />} title="Stopped, and everything signed out">
          <p>
            The change was cancelled and every device signed in to your account has been signed
            out. Your email address is unchanged.
          </p>
          <p>
            If this was not you, change your password now — whoever asked for it was able to use
            your account. Tell your administrator too.
          </p>
        </AuthNotice>
        <p className="text-center text-[12px] text-[#5F6B7C]">
          <Link href="/forgot-password" className={AUTH_LINK}>
            Change your password
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <AuthNotice icon={<RiShieldKeyholeLine />} title="Nothing has changed yet">
        <p>
          Approving sends a second email to the new address to check it works. Only after that does
          your sign-in address actually change.
        </p>
        <p>
          If you did not ask for this, choose <strong>No</strong> below. That stops the change and
          signs out every device on your account.
        </p>
      </AuthNotice>

      {error ? <p className="text-[12.5px] text-[#B03A3A]">{error}</p> : null}

      <div className="grid gap-2">
        <Button type="button" disabled={pending} onClick={() => approve.mutate()}>
          {approve.isPending ? "Approving…" : "Yes, this was me"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => refuse.mutate()}
          className="text-[#B03A3A] hover:bg-[#FDF6F6] hover:text-[#8C2E2E]"
        >
          {refuse.isPending ? "Stopping…" : "No, this wasn't me"}
        </Button>
      </div>
    </div>
  )
}
