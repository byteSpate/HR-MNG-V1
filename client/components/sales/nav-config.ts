import type { NavGroup } from "@/components/dashboard/types"
import type { SalesRole } from "@/lib/api/types"

/**
 * A function rather than a constant: the tree can grow by `salesRole` (an
 * admin-only Setup group, eventually) without a branch anywhere else.
 *
 * Deliberately thin for now. "Contacts" and "Communication Log" have no
 * route of their own — they live inside the account detail page — and a
 * Sales Admin "Hub Access" screen is not built either (access is still
 * granted with a direct PATCH). A nav item pointing at a page that says
 * nothing is exactly what this rule exists to stop, so only the two account
 * lists are listed until a real page backs anything more.
 *
 * A hidden nav item is not access control — the server still refuses.
 *
 * The landing page's own nav item reads "Overview", not "Dashboard": the
 * header's BackToDashboardButton already uses "Dashboard" for the way back
 * to the person's role dashboard, and the landing page itself says plainly
 * that there is no dashboard here yet (that arrives with Phase 2) — calling
 * both "Dashboard" would read as two different destinations for one word,
 * on screen at the same time.
 */
export function navGroups(salesRole: SalesRole | null, canOwnAccounts: boolean): NavGroup[] {
  // Not yet branched on: an admin-only Setup group belongs here once
  // /sales/settings/access exists, but not before — see the comment above.
  void salesRole

  return [
    {
      label: "Sales",
      items: [
        { label: "Overview", href: "/sales", icon: "RiDashboardLine" },
        // Hidden from a login that cannot own an account at all. Super Admin
        // and HR Admin are seeded with no Employee row, and accounts are
        // owned by and assigned to *employees* — so "My Accounts" is
        // permanently empty for them by construction, not by circumstance.
        // A nav item onto a page that can never hold anything is the same
        // defect as one onto a page that says nothing.
        ...(canOwnAccounts
          ? [{ label: "My Accounts", href: "/sales/my-accounts", icon: "RiBuilding2Line" } as const]
          : []),
        // The working list for an admin, and the shared directory for
        // everyone else. It owns the bare /sales/accounts path so that an
        // account's own page nests beneath it: the sidebar marks a link
        // active by path prefix, so the directory and the records inside it
        // must share a root, and nothing else may sit above that root. When
        // "My Accounts" lived at /sales/accounts, opening All Accounts lit
        // both — which is the bug this arrangement removes rather than
        // special-cases.
        { label: "All Accounts", href: "/sales/accounts", icon: "RiApps2Line" },
      ],
    },
  ]
}
