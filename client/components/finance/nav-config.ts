import type { NavGroup } from "@/components/dashboard/types"

export const navGroups: NavGroup[] = [
  {
    label: "Finance",
    items: [
      { label: "Dashboard", href: "/finance", icon: "RiDashboardLine" },
      { label: "Payroll", href: "/finance/payroll", icon: "RiWallet3Line" },
      // Finance authors the pay bands; HR assigns people to them. Sits above
      // Expenses because no run can process until one exists.
      { label: "Salary structures", href: "/finance/salary-structures", icon: "RiSettingsLine" },
      { label: "Employee expenses", href: "/finance/expenses", icon: "RiReceiptLine" },
      { label: "Settlements", href: "/finance/settlements", icon: "RiHandCoinLine" },
      { label: "Expenses", href: "/finance/costs", icon: "RiBillLine" },
      { label: "Posting rules", href: "/finance/posting-rules", icon: "RiSettingsLine" },
      { label: "Assets", href: "/finance/assets", icon: "RiComputerLine" },
      { label: "Depreciation", href: "/finance/depreciation", icon: "RiCalculatorLine" },
      { label: "Asset value", href: "/finance/assets/value", icon: "RiPieChartLine" },
      // Finance is a publisher server-side, so without this entry the
      // permission would exist and be unreachable from the UI.
      { label: "Announcements", href: "/finance/announcements", icon: "RiMegaphoneLine" },
    ],
  },
  {
    label: "Accounting",
    items: [
      { label: "Journals", href: "/finance/accounting/journals", icon: "RiFileList3Line" },
      { label: "Financial statements", href: "/finance/accounting/statements", icon: "RiFileChartLine" },
      { label: "Cash flow", href: "/finance/statements/cash-flow", icon: "RiExchangeDollarLine" },
      { label: "Notes", href: "/finance/statements/notes", icon: "RiFileTextLine" },
      { label: "Annexure-A", href: "/finance/statements/annexure-a", icon: "RiTableLine" },
      { label: "Policy notes", href: "/finance/statements/policy-notes", icon: "RiArticleLine" },
      { label: "Chart of accounts", href: "/finance/accounting/accounts", icon: "RiNodeTree" },
      { label: "General ledger", href: "/finance/accounting/ledger", icon: "RiBookOpenLine" },
      { label: "Cash book", href: "/finance/accounting/cash-book", icon: "RiCashLine" },
      { label: "Bank book", href: "/finance/accounting/bank-book", icon: "RiBankLine" },
      { label: "Trial balance", href: "/finance/accounting/trial-balance", icon: "RiScales3Line" },
      // Setup, and used rarely — last, below the things used daily.
      { label: "Years & periods", href: "/finance/accounting/periods", icon: "RiCalendarCheckLine" },
      { label: "Opening balances", href: "/finance/accounting/opening-balances", icon: "RiPlayCircleLine" },
    ],
  },
  {
    label: "Reference (read)",
    items: [
      { label: "Employees", href: "/finance/employees", icon: "RiTeamLine" },
      { label: "Attendance", href: "/finance/attendance", icon: "RiTimeLine" },
      { label: "Leave", href: "/finance/leave", icon: "RiCalendarEventLine" },
      { label: "Reports", href: "/finance/reports", icon: "RiBarChartLine" },
    ],
  },
  {
    label: "Account",
    items: [
      { label: "Settings", href: "/finance/settings", icon: "RiSettingsLine" },
      { label: "My Profile", href: "/finance/profile", icon: "RiUser3Line" },
    ],
  },
]
