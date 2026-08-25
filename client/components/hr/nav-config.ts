import type { NavGroup } from "@/components/dashboard/types"

export const navGroups: NavGroup[] = [
  {
    label: "People",
    items: [
      { label: "Dashboard", href: "/hr", icon: "RiDashboardLine" },
      { label: "Employees", href: "/hr/employees", icon: "RiTeamLine" },
      { label: "Attendance", href: "/hr/attendance", icon: "RiTimeLine" },
      { label: "Leave", href: "/hr/leave", icon: "RiCalendarEventLine" },
      { label: "Assets", href: "/hr/assets", icon: "RiComputerLine" },
    ],
  },
  {
    label: "Payroll (read)",
    items: [
      { label: "Payroll", href: "/hr/payroll", icon: "RiWallet3Line" },
      { label: "Employee expenses", href: "/hr/expenses", icon: "RiReceiptLine" },
      { label: "Settlements", href: "/hr/settlements", icon: "RiReceiptLine" },
      { label: "Expenses", href: "/hr/costs", icon: "RiBillLine" },
    ],
  },
  {
    label: "Communication",
    items: [
      { label: "Reports", href: "/hr/reports", icon: "RiBarChartLine" },
      { label: "Announcements", href: "/hr/announcements", icon: "RiMegaphoneLine" },
      { label: "Settings", href: "/hr/settings", icon: "RiSettingsLine" },
      { label: "My Profile", href: "/hr/profile", icon: "RiUser3Line" },
    ],
  },
]
