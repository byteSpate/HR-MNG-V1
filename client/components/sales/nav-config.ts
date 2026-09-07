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
 * nothing is exactly what this rule exists to stop, so only "Accounts" is
 * listed until a real page backs anything more.
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
export function navGroups(salesRole: SalesRole | null): NavGroup[] {
  // Not yet branched on: an admin-only Setup group belongs here once
  // /sales/settings/access exists, but not before — see the comment above.
  void salesRole

  return [
    {
      label: "Sales",
      items: [
        { label: "Overview", href: "/sales", icon: "RiDashboardLine" },
        { label: "Accounts", href: "/sales/accounts", icon: "RiBuilding2Line" },
      ],
    },
  ]
}
