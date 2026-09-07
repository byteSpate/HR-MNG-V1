"use client"

import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { navGroups } from "@/components/sales/nav-config"
import { useSession } from "@/lib/auth/session-context"

/**
 * Turns the signed-in session into the hub's nav tree.
 *
 * A Server Component layout — the shape every role layout uses — has no
 * access to the session: it resolves client-side, after the silent refresh
 * on mount. The nav tree here depends on `salesRole`, which only exists in
 * that session, so this stays a client component even though the five role
 * layouts mount `DashboardShell` directly.
 */
export function SalesShell({ children }: { children: React.ReactNode }) {
  const { user } = useSession()

  return (
    <DashboardShell
      navGroups={navGroups(user?.salesRole ?? null)}
      rootHref="/sales"
      tone="sales"
      // Wider than a role dashboard's 1220/1600px cap: the accounts table
      // (Day 5) and, later, the Opportunities pipeline want more columns
      // than a role dashboard's panels ever did.
      mainClassName="max-w-[1320px] 2xl:max-w-[1760px]"
    >
      {children}
    </DashboardShell>
  )
}
