import type { NavGroup } from "@/components/dashboard/types"

export const navGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/admin", icon: "RiDashboardLine" },
      { label: "Employees", href: "/admin/employees", icon: "RiTeamLine" },
      { label: "Attendance", href: "/admin/attendance", icon: "RiTimeLine" },
      { label: "Leave", href: "/admin/leave", icon: "RiCalendarEventLine" },
      { label: "Assets", href: "/admin/assets", icon: "RiComputerLine" },
    ],
  },
  {
    label: "Payroll & finance",
    items: [
      { label: "Payroll", href: "/admin/payroll", icon: "RiWallet3Line" },
      { label: "Salary structures", href: "/admin/salary-structures", icon: "RiSettingsLine" },
      { label: "Employee expenses", href: "/admin/expenses", icon: "RiReceiptLine" },
      { label: "Settlements", href: "/admin/settlements", icon: "RiHandCoinLine" },
      { label: "Expenses", href: "/admin/costs", icon: "RiBillLine" },
      { label: "Posting rules", href: "/admin/posting-rules", icon: "RiSettingsLine" },
    ],
  },
  {
    // Setup and master data: done once, or rarely. Split out of what used to
    // be one 15-item "Accounting" group (see Ledger and Statements below) —
    // matches the guide page's own "Set up" step.
    label: "Accounting",
    items: [
      { label: "Guide", href: "/admin/accounting/guide", icon: "RiQuestionLine" },
      { label: "Chart of accounts", href: "/admin/accounting/accounts", icon: "RiNodeTree" },
      { label: "Customers", href: "/admin/accounting/customers", icon: "RiUserLine" },
      { label: "Suppliers", href: "/admin/accounting/suppliers", icon: "RiTruckLine" },
      // Setup, and used rarely — last, below the things used daily.
      { label: "Years & periods", href: "/admin/accounting/periods", icon: "RiCalendarCheckLine" },
      { label: "Opening balances", href: "/admin/accounting/opening-balances", icon: "RiPlayCircleLine" },
    ],
  },
  {
    // The guide's "Post" and "Read" steps: where entries land and how
    // they're read back, one account or one book at a time.
    label: "Ledger",
    items: [
      { label: "Journals", href: "/admin/accounting/journals", icon: "RiFileList3Line" },
      { label: "General ledger", href: "/admin/accounting/ledger", icon: "RiBookOpenLine" },
      { label: "Cash book", href: "/admin/accounting/cash-book", icon: "RiCashLine" },
      { label: "Bank book", href: "/admin/accounting/bank-book", icon: "RiBankLine" },
      { label: "Trial balance", href: "/admin/accounting/trial-balance", icon: "RiScales3Line" },
    ],
  },
  {
    // The guide's "Report" step: what gets filed.
    label: "Statements",
    items: [
      { label: "Financial statements", href: "/admin/accounting/statements", icon: "RiFileChartLine" },
      { label: "Cash flow", href: "/admin/statements/cash-flow", icon: "RiExchangeDollarLine" },
      { label: "Notes", href: "/admin/statements/notes", icon: "RiFileTextLine" },
      { label: "Annexure-A", href: "/admin/statements/annexure-a", icon: "RiTableLine" },
      { label: "Policy notes", href: "/admin/statements/policy-notes", icon: "RiArticleLine" },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Users", href: "/admin/users", icon: "RiTeamLine" },
      { label: "Reports", href: "/admin/reports", icon: "RiBarChartLine" },
      { label: "Activity", href: "/admin/activity", icon: "RiPulseLine" },
      { label: "Announcements", href: "/admin/announcements", icon: "RiMegaphoneLine" },
      { label: "Emails", href: "/admin/emails", icon: "RiMailLine" },
      { label: "Settings", href: "/admin/settings", icon: "RiSettingsLine" },
      { label: "My Profile", href: "/admin/profile", icon: "RiUser3Line" },
    ],
  },
]
