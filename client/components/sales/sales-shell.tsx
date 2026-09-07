"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { navGroups } from "@/components/sales/nav-config"
import { ROLE_ROUTES } from "@/lib/auth/role-routes"
import { useSession } from "@/lib/auth/session-context"

/**
 * Turns the signed-in session into the hub's nav tree.
 *
 * A Server Component layout — the shape every role layout uses — has no
 * access to the session: it resolves client-side, after the silent refresh
 * on mount. The nav tree here depends on `salesRole`, which only exists in
 * that session, so this stays a client component even though the five role
 * layouts mount `DashboardShell` directly.
 *
 * This is also the only route-group shell of the five that gates on
 * anything beyond "signed in" — `client/proxy.ts` is a cookie-presence
 * check, the same UX-only guard every role route already relies on, and it
 * cannot read `salesRole` (an opaque refresh-token cookie, not a decodable
 * claim) without a second network round trip. `requireSales` on the server
 * is the actual authorization boundary and was never in question — this
 * redirect exists so a signed-in employee typing /sales into the address
 * bar lands somewhere real instead of staring at an empty hub shell with
 * no way in, which is a materially worse experience here than it is on
 * /admin or /finance: `salesRole` is optional and most employees do not
 * hold it, where a role mismatch on the other five routes is not a path
 * anyone reaches by anything other than a typo.
 */
export function SalesShell({ children }: { children: React.ReactNode }) {
  const { user, status } = useSession()
  const router = useRouter()
  const canEnter = !!user && (user.role === "SUPER_ADMIN" || !!user.salesRole)

  useEffect(() => {
    if (status === "authenticated" && user && !canEnter) {
      router.replace(ROLE_ROUTES[user.role])
    }
  }, [status, user, canEnter, router])

  if (status === "authenticated" && user && !canEnter) {
    return null
  }

  return (
    <DashboardShell
      navGroups={navGroups(user?.salesRole ?? null)}
      rootHref="/sales"
      tone="sales"
      // Wider than a role dashboard's 1220/1600px cap: the accounts table
      // (Day 5) and, later, the Opportunities pipeline want more columns
      // than a role dashboard's panels ever did.
      mainClassName="max-w-[1320px] 2xl:max-w-[1760px]"
      // The hub has no profile page of its own — this is the person's real
      // role dashboard's profile, the same page every other route's account
      // menu already points at.
      profileHref={user ? `${ROLE_ROUTES[user.role]}/profile` : undefined}
    >
      {children}
    </DashboardShell>
  )
}
