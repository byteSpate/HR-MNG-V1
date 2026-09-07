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
 */
export function navGroups(salesRole: SalesRole | null): NavGroup[] {
  // Not yet branched on: an admin-only Setup group belongs here once
  // /sales/settings/access exists, but not before — see the comment above.
  void salesRole

  return [
    {
      label: "Sales",
      items: [
        { label: "Dashboard", href: "/sales", icon: "RiDashboardLine" },
        { label: "Accounts", href: "/sales/accounts", icon: "RiBuilding2Line" },
      ],
    },
  ]
}
