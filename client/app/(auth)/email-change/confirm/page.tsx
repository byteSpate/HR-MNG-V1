import type { Metadata } from "next"
import Link from "next/link"
import { RiLinkUnlinkM } from "@remixicon/react"

import { AUTH_LINK, AuthNotice } from "../../auth-form-ui"
import { AuthShell } from "../../auth-shell"
import { ConfirmEmailChangeForm } from "./confirm-form"

export const metadata: Metadata = {
  title: "Confirm your new email | byteSpate",
}

/**
 * Where the link in the **new** inbox lands, and the last step.
 *
 * Path fixed by the server as `${CLIENT_ORIGIN}/email-change/confirm?token=…`.
 *
 * Unauthenticated by necessity rather than convenience: the whole point is
 * that the reader is holding the *new* inbox, which by definition is not yet
 * the account they could sign in with.
 */
export default async function ConfirmEmailChangePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const raw = (await searchParams).token
  const token = Array.isArray(raw) ? raw[0] : raw

  if (!token) {
    return (
      <AuthShell
        title="This link is incomplete"
        subtitle="It arrived without the token that proves it is yours."
      >
        <div className="grid gap-4">
          <AuthNotice icon={<RiLinkUnlinkM />} title="Nothing to confirm">
            <p>
              Mail clients sometimes cut a long link in half. Opening the link directly from the
              email usually fixes it.
            </p>
            <p>Nothing has changed on the account.</p>
          </AuthNotice>
          <p className="text-center text-[12px] text-[#5F6B7C]">
            <Link href="/login" className={AUTH_LINK}>
              Back to sign in
            </Link>
          </p>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Confirm this address"
      subtitle="One click and this becomes the address you sign in with."
    >
      <ConfirmEmailChangeForm token={token} />
    </AuthShell>
  )
}
