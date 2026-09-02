import type { NavGroup } from "@/components/dashboard/types"

export const navGroups: NavGroup[] = [
  {
    label: "My team",
    items: [
      { label: "Dashboard", href: "/manager", icon: "RiDashboardLine" },
      { label: "Team", href: "/manager/team", icon: "RiTeamLine" },
      { label: "Attendance", href: "/manager/attendance", icon: "RiTimeLine" },
      { label: "Leave", href: "/manager/leave", icon: "RiCalendarEventLine" },
      { label: "Assets", href: "/manager/assets", icon: "RiComputerLine" },
    ],
  },
  {
    label: "Reporting",
    items: [
      { label: "Reports", href: "/manager/reports", icon: "RiBarChartLine" },
      { label: "Activity", href: "/manager/activity", icon: "RiPulseLine" },
      { label: "Announcements", href: "/manager/announcements", icon: "RiMegaphoneLine" },
    ],
  },
  {
    // A Reporting Manager is a paid employee who may travel, so they hold a
    // payslip and expenses of their own. The matrix's âŒ for Manager on
    // Payroll means "cannot administer payroll", not "has no payslip".
    label: "Account",
    items: [
      { label: "My Profile", href: "/manager/profile", icon: "RiUser3Line" },
      { label: "Payroll", href: "/manager/payroll", icon: "RiWallet3Line" },
      { label: "Employee expenses", href: "/manager/expenses", icon: "RiReceiptLine" },
    ],
  },
]
