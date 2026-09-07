"use client"

import { cn } from "@/lib/utils"
import { Header } from "@/components/dashboard/header"
import { Sidebar } from "@/components/dashboard/sidebar"
import { SidebarProvider } from "@/components/ui/sidebar"
import { HelpProvider } from "@/components/help/help-provider"
import type { NavGroup } from "@/components/dashboard/types"

export function DashboardShell({
  navGroups,
  rootHref,
  tone = "default",
  mainClassName = "max-w-[1220px] 2xl:max-w-[1600px]",
  profileHref: profileHrefOverride,
  children,
}: {
  navGroups: NavGroup[]
  rootHref: string
  /** The one visual difference between the role dashboards and the Sales
      Hub: a lighter sidebar. Defaults to today's value, so the five role
      layouts render unchanged. */
  tone?: "default" | "sales"
  /** The content cap. Defaults to today's value; the Sales Hub passes a
      wider one — its tables want more columns than a role dashboard's. */
  mainClassName?: string
  /** Overrides the derived `${rootHref}/profile`. The Sales Hub has no
      profile page of its own — the account menu there needs to point at
      the person's actual role dashboard's profile instead, which is not
      derivable from `rootHref="/sales"`. */
  profileHref?: string
  children: React.ReactNode
}) {
  // Every role group has a `/profile` route under its own root, so this is
  // derivable rather than another prop each layout has to remember to pass —
  // true for all five role dashboards, not for the Sales Hub above.
  const profileHref = profileHrefOverride ?? `${rootHref}/profile`

  return (
    // The primitive's default width is 16rem; ours is 236px. It sets the
    // variable as an inline style on its own wrapper, so this style prop —
    // spread after the defaults — is the override point. Editing the vendored
    // constant would be undone by the next `shadcn add`.
    <SidebarProvider style={{ "--sidebar-width": "236px" } as React.CSSProperties}>
      {/* HelpProvider wraps every role dashboard via this shared shell: the
          panel renders once above the page, and the header trigger opens it. */}
      <HelpProvider>
        <Sidebar navGroups={navGroups} rootHref={rootHref} profileHref={profileHref} tone={tone} />
        {/* Deliberately not SidebarInset: that renders its own <main>, and the
            content area below already is one. Nested <main> is invalid. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <Header profileHref={profileHref} />
          <main className={cn("mx-auto flex w-full flex-1 flex-col px-4 pb-8 sm:px-6 lg:px-7", mainClassName)}>
            {children}
          </main>
        </div>
      </HelpProvider>
    </SidebarProvider>
  )
}
