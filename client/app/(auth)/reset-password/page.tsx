import type { Metadata } from "next"
import Link from "next/link"
import { RiLinkUnlinkM } from "@remixicon/react"

import { AUTH_LINK, AuthNotice } from "../auth-form-ui"
import { AuthShell } from "../auth-shell"
import { ResetPasswordForm } from "./reset-password-form"

export const metadata: Metadata = {
  title: "Set a new password | byteSpate",
}

/**
 * The path is fixed by the server, which builds the email link as
 * `${CLIENT_ORIGIN}/reset-password?token=…`. Renaming this route breaks every
 * link already sitting in someone's inbox.
 *
 * The token is read here rather than with `useSearchParams` in the form so
 * there is no client-side suspense boundary to arrange, and so the missing
 * token case is decided before anything renders.
 */
export default async function ResetPasswordPage({
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
          <AuthNotice icon={<RiLinkUnlinkM />} title="Nothing to verify">
            <p>
              Mail clients sometimes cut a long link in half, and copying one by hand can leave the
              tail behind. Opening the link directly from the email usually fixes it.
            </p>
            <p>If it keeps happening, ask for a fresh link and use the newest email.</p>
          </AuthNotice>
          <p className="text-center text-caption text-ink-muted">
            <Link href="/forgot-password" className={AUTH_LINK}>
              Request a new link
            </Link>
          </p>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Set a new password"
      subtitle="Choose one you have not used on this account before."
    >
      <ResetPasswordForm token={token} />
    </AuthShell>
  )
}
