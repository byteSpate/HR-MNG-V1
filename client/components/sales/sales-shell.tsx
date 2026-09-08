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

  // Two ways to be in the wrong place, needing different destinations. The
  // second was missing: when the silent refresh fails — a stale or expired
  // refresh cookie, which `client/proxy.ts` cannot catch because it only
  // checks the cookie is *present* — status settles on "unauthenticated" and
  // nothing moved, leaving a visitor inside an empty hub shell whose every
  // panel then failed to load.
  const wrongRole = status === "authenticated" && !!user && !canEnter
  const signedOut = status === "unauthenticated"

  useEffect(() => {
    if (wrongRole && user) router.replace(ROLE_ROUTES[user.role])
    else if (signedOut) router.replace("/login")
  }, [wrongRole, signedOut, user, router])

  if (wrongRole || signedOut) {
    return null
  }

  return (
    <DashboardShell
      // `employeeCode` is the session's one signal for "this login has an
      // Employee row" — attached on login and re-attached on refresh for
      // staff, absent for the three administrative roles, which have no
      // Employee row at all. Accounts are owned by employees, so its absence
      // means this person can never own one.
      navGroups={navGroups(user?.salesRole ?? null, !!user?.employeeCode)}
      rootHref="/sales"
      tone="sales"
      systemLabel="Techno Sales Hub"
      // A Super Admin holds no salesRole but is treated as a Sales Admin by
      // requireSales, so the rail names what they can actually do here rather
      // than what their row happens to store.
      accessLabel={
        user?.salesRole === "SALES_ADMIN" || user?.role === "SUPER_ADMIN"
          ? "Sales Admin"
          : user?.salesRole === "SALES_USER"
            ? "Sales User"
            : undefined
      }
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
