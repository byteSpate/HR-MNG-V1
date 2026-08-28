import type { Metadata } from "next"
import Link from "next/link"
import { RiLinkUnlinkM } from "@remixicon/react"

import { AUTH_LINK, AuthNotice } from "../../auth-form-ui"
import { AuthShell } from "../../auth-shell"
import { ApproveEmailChangeForm } from "./approve-form"

export const metadata: Metadata = {
  title: "Approve an email change | byteSpate",
}

/**
 * Where the link in the **current** inbox lands.
 *
 * The path is fixed by the server, which builds it as
 * `${CLIENT_ORIGIN}/email-change/approve?token=…`. Renaming this route breaks
 * every link already sitting in somebody's inbox.
 *
 * Deliberately reachable without signing in. The token is the proof, and the
 * person reading this may well be on a phone that is not signed in — or may
 * be reading it precisely because somebody *else* has their session.
 */
export default async function ApproveEmailChangePage({
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
          <AuthNotice icon={<RiLinkUnlinkM />} title="Nothing to approve">
            <p>
              Mail clients sometimes cut a long link in half, and copying one by hand can leave the
              tail behind. Opening the link directly from the email usually fixes it.
            </p>
            <p>Nothing has changed on your account.</p>
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
      title="Was this you?"
      subtitle="Someone asked to move your account to a different email address."
    >
      <ApproveEmailChangeForm token={token} />
    </AuthShell>
  )
}
