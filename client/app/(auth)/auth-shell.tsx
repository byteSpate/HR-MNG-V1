import type { ReactNode } from "react"

import { BrandLogo } from "@/components/brand/brand"
import { Heading } from "@/components/ds/heading"

/**
 * The split screen every signed-out page sits in.
 *
 * This was inline in the login page until password reset needed it too. The
 * reasoning that put the brand panel there applies harder on the reset
 * screens: a sign-in is something you went looking for, while a reset link is
 * opened from an email, cold, often on a phone, and the panel is the only
 * thing on the page that says which system is being changed.
 *
 * Only the right-hand column varies. The panel's own copy is about byteSpate
 * rather than about the form beside it, so it stays fixed here instead of
 * becoming three near-identical props.
 */
export function AuthShell({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string
  subtitle: string
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex min-h-[100dvh] w-full flex-col md:flex-row">
      {/*
        Below md this collapses to a strip carrying the brand alone. The panel
        is not decoration: on a shared office machine it is the only thing that
        says which system is being signed into.
      */}
      <aside className="relative isolate flex w-full min-w-0 flex-col overflow-hidden bg-ink-strong px-6 py-5 text-white md:w-[42%] md:min-w-95 md:p-10">
        {/*
          The source logo is a glow on black. Echoing it here in the brand's own
          red and green keeps the panel from being a flat rectangle without
          reaching for a stock photograph, which on an internal sign-in screen
          would be decoration rather than information.
        */}
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-24 -z-10 size-[26rem] rounded-full opacity-45 blur-3xl"
          style={{ background: "radial-gradient(circle, #FE0101 0%, transparent 68%)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-28 left-1/3 -z-10 size-72 rounded-full opacity-25 blur-3xl"
          style={{ background: "radial-gradient(circle, #028805 0%, transparent 70%)" }}
        />

        <BrandLogo tone="dark" width={186} className="self-start" />

        <div className="my-auto hidden max-w-105 md:block">
          <h2 className="font-heading text-[34px] leading-[1.12] font-bold tracking-tighter text-balance">
            One login. Your whole working month.
          </h2>
          <p className="mt-4.5 max-w-[46ch] text-body leading-[1.7] text-white/60">
            Check in, request leave, read payslips, approve claims. Whatever your role, it is behind
            this door.
          </p>
        </div>

        {/* No tagline line here: the lockup above already carries it, and
            printing it twice on one panel reads as a mistake. */}
      </aside>

      <main className="flex flex-1 items-start justify-center px-5 pt-10 pb-12 md:items-center md:px-7 md:py-10">
        <div className="w-full max-w-100">
          <Heading level="display">{title}</Heading>
          <p className="mt-2 mb-7 text-body-sm text-ink-muted">{subtitle}</p>

          {children}

          {footer ? (
            <div className="mt-6 border-t border-line pt-5 text-center text-caption leading-[1.6] text-ink-muted">
              {footer}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  )
}
