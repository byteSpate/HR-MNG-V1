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
      { label: "Assets", href: "/finance/assets", icon: "RiComputerLine" },
      { label: "Depreciation", href: "/finance/depreciation", icon: "RiCalculatorLine" },
      { label: "Asset value", href: "/finance/assets/value", icon: "RiPieChartLine" },
      // Finance is a publisher server-side, so without this entry the
      // permission would exist and be unreachable from the UI.
      { label: "Announcements", href: "/finance/announcements", icon: "RiMegaphoneLine" },
    ],
  },
  {
    // Setup and master data: done once, or rarely. Split out of what used to
    // be one 15-item "Accounting" group (see Ledger and Statements below) —
    // matches the guide page's own "Set up" step.
    label: "Accounting",
    items: [
      { label: "Guide", href: "/finance/accounting/guide", icon: "RiQuestionLine" },
      { label: "Chart of accounts", href: "/finance/accounting/accounts", icon: "RiNodeTree" },
      { label: "Customers", href: "/finance/accounting/customers", icon: "RiUserLine" },
      { label: "Suppliers", href: "/finance/accounting/suppliers", icon: "RiTruckLine" },
      // Setup, and used rarely — last, below the things used daily.
      { label: "Years & periods", href: "/finance/accounting/periods", icon: "RiCalendarCheckLine" },
      { label: "Opening balances", href: "/finance/accounting/opening-balances", icon: "RiPlayCircleLine" },
    ],
  },
  {
    // The guide's "Post" and "Read" steps: where entries land and how
    // they're read back, one account or one book at a time.
    label: "Ledger",
    items: [
      // Pairs with Journals in the guide's own "Post" step — the map that
      // decides which account a journal line lands on.
      { label: "Posting rules", href: "/finance/posting-rules", icon: "RiSettingsLine" },
      { label: "Journals", href: "/finance/accounting/journals", icon: "RiFileList3Line" },
      { label: "General ledger", href: "/finance/accounting/ledger", icon: "RiBookOpenLine" },
      { label: "Cash book", href: "/finance/accounting/cash-book", icon: "RiCashLine" },
      { label: "Bank book", href: "/finance/accounting/bank-book", icon: "RiBankLine" },
      { label: "Trial balance", href: "/finance/accounting/trial-balance", icon: "RiScales3Line" },
    ],
  },
  {
    // Receivables & payables, Phase 3a (Selling): what customers owe us.
    // Before Payables because a sale is where a deal's money starts.
    label: "Receivables",
    items: [
      { label: "Customer POs", href: "/finance/accounting/customer-pos", icon: "RiShoppingBag3Line" },
      { label: "Invoices", href: "/finance/accounting/invoices", icon: "RiFileList2Line" },
      { label: "Deliveries & acceptances", href: "/finance/accounting/deliveries", icon: "RiTruckLine" },
      { label: "Monthly earnings", href: "/finance/accounting/monthly-earnings", icon: "RiCalendarCheckLine" },
      { label: "Receipts", href: "/finance/accounting/receipts", icon: "RiCoinsLine" },
      { label: "Customer credit notes", href: "/finance/accounting/customer-credit-notes", icon: "RiFileReduceLine" },
      { label: "Customer ageing", href: "/finance/accounting/customer-ageing", icon: "RiTimeLine" },
    ],
  },
  {
    // Receivables & payables, Phase 2 (Buying): what we owe suppliers.
    // Its own group rather than more rows under Ledger, which would take
    // that group back to the crowding the split was made to fix.
    label: "Payables",
    items: [
      { label: "Supplier bills", href: "/finance/accounting/supplier-bills", icon: "RiBillLine" },
      { label: "Supplier payments", href: "/finance/accounting/supplier-payments", icon: "RiHandCoinLine" },
      { label: "Supplier credit notes", href: "/finance/accounting/supplier-credit-notes", icon: "RiFileReduceLine" },
      { label: "Supplier ageing", href: "/finance/accounting/supplier-ageing", icon: "RiTimeLine" },
    ],
  },
  {
    // The guide's "Report" step: what gets filed.
    label: "Statements",
    items: [
      { label: "Financial statements", href: "/finance/accounting/statements", icon: "RiFileChartLine" },
      { label: "Cash flow", href: "/finance/statements/cash-flow", icon: "RiExchangeDollarLine" },
      { label: "Notes", href: "/finance/statements/notes", icon: "RiFileTextLine" },
      { label: "Annexure-A", href: "/finance/statements/annexure-a", icon: "RiTableLine" },
      { label: "Policy notes", href: "/finance/statements/policy-notes", icon: "RiArticleLine" },
    ],
  },
  {
    label: "Reference (read)",
    items: [
      { label: "Employees", href: "/finance/employees", icon: "RiTeamLine" },
      { label: "Attendance", href: "/finance/attendance", icon: "RiTimeLine" },
      { label: "Leave", href: "/finance/leave", icon: "RiCalendarEventLine" },
      { label: "Reports", href: "/finance/reports", icon: "RiBarChartLine" },
      { label: "Activity", href: "/finance/activity", icon: "RiPulseLine" },
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
