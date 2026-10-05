"use client"

import type { ReactNode } from "react"

import { BrandLogo } from "@/components/brand/brand"
import { loginScreen } from "@/lib/auth/return-to"
import { useSession } from "@/lib/auth/session-context"

import { AlreadySignedIn } from "./already-signed-in"

/**
 * Decides whether the sign-in form may be drawn at all.
 *
 * Opening the site always lands here first (the home page sends everyone to
 * /login), and the session check that follows takes a moment. Drawing the form
 * in that moment and then jumping to the dashboard made a signed-in person
 * think they had been signed out. While the check runs, and while a signed-in
 * person is sent on, this shows a loading screen. The form comes back only when
 * the session is known to be gone.
 */
export function LoginGate({ hasRefreshCookie, children }: { hasRefreshCookie: boolean; children: ReactNode }) {
  const { status } = useSession()
  const screen = loginScreen({ status, hasRefreshCookie })

  return (
    <>
      <AlreadySignedIn />
      {screen === "checking" ? <CheckingSession /> : children}
    </>
  )
}

function CheckingSession() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[100dvh] w-full flex-col items-center justify-center gap-8 px-6"
    >
      <BrandLogo tone="light" width={186} />
      <div className="flex flex-col items-center gap-4">
        <span
          aria-hidden
          className="size-10 rounded-full border-[3px] border-[#E4E9EF] border-t-[#17191C] animate-spin motion-reduce:animate-none"
        />
        <p className="font-heading text-[18px] font-semibold tracking-tight">Checking your sign-in</p>
        <p className="text-[13.5px] text-[#55657A]">Please wait a moment.</p>
      </div>
    </div>
  )
}
