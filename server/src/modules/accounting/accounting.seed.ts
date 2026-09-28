/**
 * The starter chart of accounts.
 *
 * This is a transcription of the company's audited FY 2024-25 financial
 * statements (G. Nabi & Co., Chartered Accountants, 22 January 2026), not a
 * generic textbook chart. Every group below is a line in the filed accounts
 * and every leaf is a row in one of their notes — the `note` field records
 * which. That is what will let slice 2 produce a document the auditor can
 * tie to their own working papers instead of one they have to re-key.
 *
 * Four things here a generic chart would not have:
 *
 * - `1120 Accumulated Depreciation` is a contra-asset group: type ASSET, but
 *   it normally carries a *credit*, and the Balance Sheet's single
 *   "Property, Plant & Equipment 126,350" line is PPE_COST − PPE_ACCUM_DEP.
 * - The P&L splits expenses four ways, not two, which is what makes a Gross
 *   Profit line derivable at all.
 * - Salary appears twice, 5122 under Direct Expenses and 5201 under
 *   Administrative. Which one a given salary lands in is a slice 3 mapping
 *   question, and it is why JournalLine.departmentId exists.
 * - `3200 Share Money Deposit` is a distinct equity account from Share
 *   Capital; it is a named column in their Statement of Changes in Equity.
 *
 * Reference data, not demo data — the same posture as the seed-slimming
 * work. Idempotent on `code`, so re-running never duplicates and never
 * overwrites a name somebody has since edited.
 */

import prisma from "../../config/prisma"
import { Prisma } from "../../generated/prisma/client"
import type { AccountCashKind, AccountType, CashFlowKind } from "../../generated/prisma/client"

export interface ChartEntry {
  code: string
  name: string
  type: AccountType
  parent?: string
  isGroup?: boolean
  cashKind?: AccountCashKind
  systemRole?: string
  /** The note number in the audited FY 2024-25 statements, where it has one. */
  note?: string
  noteRef?: string
  cashFlow?: CashFlowKind
  rate?: string
  contra?: string
}

const g = (
  code: string,
  name: string,
  type: AccountType,
  extra: Partial<ChartEntry> = {}
): ChartEntry => ({ code, name, type, isGroup: true, ...extra })

const a = (
  code: string,
  name: string,
  type: AccountType,
  parent: string,
  extra: Partial<ChartEntry> = {}
): ChartEntry => ({ code, name, type, parent, isGroup: false, ...extra })

/** Ordered parents-before-children, so one pass can create the whole tree. */
export const CHART: ChartEntry[] = [
  // ── 1000 ASSETS ──
  g("1000", "Assets", "ASSET"),
  g("1100", "Non-Current Assets", "ASSET", { parent: "1000", systemRole: "NON_CURRENT_ASSETS" }),
  g("1110", "Property, Plant & Equipment", "ASSET", { parent: "1100", systemRole: "PPE_COST", note: "4.00", noteRef: "4.00" }),
  a("1111", "Furniture & Fixture", "ASSET", "1110", { cashFlow: "INVESTING", rate: "10.00", contra: "1121" }),
  a("1112", "Office Equipments", "ASSET", "1110", { cashFlow: "INVESTING", rate: "10.00", contra: "1122" }),
  a("1113", "Software / Domain", "ASSET", "1110", { cashFlow: "INVESTING", rate: "25.00", contra: "1123" }),
  a("1114", "Computer / Laptop", "ASSET", "1110", { cashFlow: "INVESTING", rate: "20.00", contra: "1124" }),
  g("1120", "Accumulated Depreciation", "ASSET", { parent: "1100", systemRole: "PPE_ACCUM_DEP" }),
  a("1121", "Acc. Dep. — Furniture & Fixture", "ASSET", "1120"),
  a("1122", "Acc. Dep. — Office Equipments", "ASSET", "1120"),
  a("1123", "Acc. Dep. — Software / Domain", "ASSET", "1120"),
  a("1124", "Acc. Dep. — Computer / Laptop", "ASSET", "1120"),
  g("1130", "Preliminary Expenses", "ASSET", { parent: "1100", note: "5.00", noteRef: "5.00" }),
  a("1131", "Registration Cost", "ASSET", "1130", { cashFlow: "INVESTING" }),
  a("1132", "Trade Licence", "ASSET", "1130", { cashFlow: "INVESTING" }),

  g("1200", "Current Assets", "ASSET", { parent: "1000", systemRole: "CURRENT_ASSETS" }),
  g("1210", "Inventories", "ASSET", { parent: "1200", note: "6.00", noteRef: "6.00" }),
  a("1211", "Developed Software (Completed)", "ASSET", "1210", { cashFlow: "OPERATING_WC" }),
  a("1212", "Raw Materials", "ASSET", "1210", { cashFlow: "OPERATING_WC" }),
  a("1213", "Software Work in Process", "ASSET", "1210", { cashFlow: "OPERATING_WC" }),
  // Goods bought for a Won deal, held here until delivered (receivables &
  // payables, Phase 1 — see docs/superpowers/specs/accounting/2026-09-21-receivables-payables-design.md §5).
  a("1214", "Goods Bought for Won Deals", "ASSET", "1210", { cashFlow: "OPERATING_WC" }),
  a("1220", "Trade and other Receivables", "ASSET", "1200", { note: "7.00", noteRef: "7.00", cashFlow: "OPERATING_WC" }),
  // Earned, not yet invoiced (receivables & payables, Phase 1).
  a("1221", "Unbilled Revenue", "ASSET", "1200", { cashFlow: "OPERATING_WC" }),
  g("1230", "Advance, Deposit & Prepayments", "ASSET", { parent: "1200", note: "8.00", noteRef: "8.00" }),
  a("1231", "Advance against Office Rent", "ASSET", "1230", { cashFlow: "OPERATING_WC" }),
  // ── receivables & payables, Phase 1 ──
  a("1232", "Advance to Suppliers", "ASSET", "1230", { cashFlow: "OPERATING_WC" }),
  a("1233", "Input VAT", "ASSET", "1230", { cashFlow: "OPERATING_WC" }),
  a("1234", "VAT Deducted at Source", "ASSET", "1230", { cashFlow: "OPERATING_WC" }),
  a("1235", "Advance Income Tax", "ASSET", "1230", { cashFlow: "OPERATING_WC" }),
  g("1240", "Cash & Cash Equivalents", "ASSET", { parent: "1200", note: "9.00", noteRef: "9.00" }),
  a("1241", "Cash in Hand", "ASSET", "1240", { cashKind: "CASH", cashFlow: "CASH" }),
  a("1242", "City Bank — A/C 1104400708001", "ASSET", "1240", { cashKind: "BANK", note: "9.01", noteRef: "9.01", cashFlow: "CASH" }),
  // Seeded so the chart is complete; nothing posts to these until slice 4.
  a("1250", "Employee Advances", "ASSET", "1200", { cashFlow: "OPERATING_WC" }),
  a("1260", "Employee Loans", "ASSET", "1200", { cashFlow: "OPERATING_WC" }),

  // ── 2000 LIABILITIES ──
  g("2000", "Liabilities", "LIABILITY"),
  g("2100", "Current Liabilities", "LIABILITY", { parent: "2000", systemRole: "CURRENT_LIABILITIES" }),
  a("2110", "Trade and other Payables", "LIABILITY", "2100", { note: "12.00", noteRef: "12.00", cashFlow: "OPERATING_WC" }),
  // Suppliers billed for a deal, kept separate from 2110 on purpose:
  // Operating Costs and Asset purchases keep crediting 2110, untouched
  // (receivables & payables, Phase 1).
  a("2111", "Trade Payables — Suppliers", "LIABILITY", "2100", { cashFlow: "OPERATING_WC" }),
  a("2120", "Provision for Income Tax", "LIABILITY", "2100", { note: "13.00", noteRef: "13.00", cashFlow: "OPERATING_WC" }),
  g("2130", "Liabilities for Expenses", "LIABILITY", { parent: "2100", note: "14.00", noteRef: "14.00" }),
  a("2131", "Audit Fee Payable", "LIABILITY", "2130", { cashFlow: "OPERATING_WC" }),
  a("2132", "Salary Payable", "LIABILITY", "2130", { cashFlow: "OPERATING_WC" }),
  a("2133", "Bonus Payable", "LIABILITY", "2130", { cashFlow: "OPERATING_WC" }),
  a("2134", "Overtime Payable", "LIABILITY", "2130", { cashFlow: "OPERATING_WC" }),
  a("2135", "Employee Reimbursements Payable", "LIABILITY", "2130", { cashFlow: "OPERATING_WC" }),
  a("2140", "Tax Deducted at Source Payable", "LIABILITY", "2100", { cashFlow: "OPERATING_WC" }),
  a("2150", "VAT Payable", "LIABILITY", "2100", { cashFlow: "OPERATING_WC" }),
  // ── receivables & payables, Phase 1 ──
  a("2160", "Customer Advances", "LIABILITY", "2100", { cashFlow: "OPERATING_WC" }),
  a("2170", "Unearned Revenue", "LIABILITY", "2100", { cashFlow: "OPERATING_WC" }),
  g("2200", "Non-Current Liabilities", "LIABILITY", { parent: "2000", systemRole: "NON_CURRENT_LIABILITIES" }),
  a("2210", "Loan Payable", "LIABILITY", "2200", { cashFlow: "FINANCING" }),

  // ── 3000 EQUITY ──
  // No systemRole on the section: `type: EQUITY` already identifies it.
  g("3000", "Equity", "EQUITY"),
  a("3100", "Share Capital", "EQUITY", "3000", { note: "10.00", noteRef: "10.00", cashFlow: "FINANCING" }),
  a("3200", "Share Money Deposit", "EQUITY", "3000", { cashFlow: "FINANCING" }),
  a("3300", "Retained Earnings", "EQUITY", "3000", { systemRole: "RETAINED_EARNINGS", note: "11.00", noteRef: "11.00" }),

  // ── 4000 INCOME ──
  g("4000", "Income", "INCOME"),
  g("4100", "Revenue", "INCOME", { parent: "4000", systemRole: "REVENUE", note: "15.00", noteRef: "15.00" }),
  a("4110", "Service Revenue — Export", "INCOME", "4100"),
  a("4120", "Service Revenue — Local", "INCOME", "4100"),
  a("4130", "Product Sales", "INCOME", "4100"),
  g("4200", "Other Income", "INCOME", { parent: "4000", systemRole: "OTHER_INCOME" }),
  a("4210", "Interest Income", "INCOME", "4200"),
  // Receivables & payables, Phase 1: a supplier paid at a different rate
  // than the bill's frozen rate.
  a("4220", "Exchange Gain", "INCOME", "4200"),
  a("4290", "Miscellaneous Income", "INCOME", "4200"),

  // ── 5000 EXPENSES ──
  g("5000", "Expenses", "EXPENSE"),
  g("5100", "Cost of Goods Sold", "EXPENSE", { parent: "5000", systemRole: "COST_OF_SALES", note: "16.00", noteRef: "16.00" }),
  a("5110", "Materials Consumed", "EXPENSE", "5100"),
  g("5120", "Direct Expenses", "EXPENSE", { parent: "5100", note: "16.01", noteRef: "16.01" }),
  a("5121", "Hardware Purchase", "EXPENSE", "5120"),
  a("5122", "Salary, Wages & Allowances", "EXPENSE", "5120"),
  a("5123", "Festival Bonus", "EXPENSE", "5120"),
  a("5124", "Electricity Charges", "EXPENSE", "5120"),
  a("5125", "Customs Duty", "EXPENSE", "5120"),
  a("5126", "C & F Expenses", "EXPENSE", "5120"),
  a("5127", "Suit & Domain Fee", "EXPENSE", "5120"),
  a("5128", "Depreciation — Direct", "EXPENSE", "5120", { cashFlow: "NON_CASH_ADDBACK" }),
  // Service lines on a supplier bill, expensed on the bill date rather than
  // held in 1214 (receivables & payables, Phase 1).
  a("5129", "Subcontract & Resold Services", "EXPENSE", "5120"),

  g("5200", "Administrative & Selling Expenses", "EXPENSE", { parent: "5000", systemRole: "ADMIN_SELLING", note: "17.00", noteRef: "17.00" }),
  a("5201", "Salary and Allowances", "EXPENSE", "5200"),
  a("5202", "Festival Bonus", "EXPENSE", "5200"),
  a("5203", "Stationary", "EXPENSE", "5200"),
  a("5204", "Software Licence", "EXPENSE", "5200"),
  a("5205", "Entertainment", "EXPENSE", "5200"),
  a("5206", "Office Rent", "EXPENSE", "5200"),
  a("5207", "Office Expense", "EXPENSE", "5200"),
  a("5208", "Travel and Conveyance", "EXPENSE", "5200"),
  a("5209", "Electricity", "EXPENSE", "5200"),
  a("5210", "WASA Bill", "EXPENSE", "5200"),
  a("5211", "Internet Bill", "EXPENSE", "5200"),
  a("5212", "IT Accessories", "EXPENSE", "5200"),
  a("5213", "Repair & Maintenance", "EXPENSE", "5200"),
  a("5214", "Audit Fee", "EXPENSE", "5200"),
  a("5215", "Depreciation — Admin", "EXPENSE", "5200", { cashFlow: "NON_CASH_ADDBACK" }),
  a("5216", "Training Expense", "EXPENSE", "5200"),
  a("5217", "Miscellaneous Expenses", "EXPENSE", "5200"),
  a("5220", "Gratuity Expense", "EXPENSE", "5200"),
  a("5221", "Notice Pay", "EXPENSE", "5200"),

  g("5300", "Financial Expenses", "EXPENSE", { parent: "5000", systemRole: "FINANCIAL_EXPENSE", note: "18.00", noteRef: "18.00" }),
  a("5310", "Bank Interest & Charges", "EXPENSE", "5300"),
  // Receivables & payables, Phase 1: the counterpart of 4220.
  a("5320", "Exchange Loss", "EXPENSE", "5300"),

  g("5400", "Income Tax Expense", "EXPENSE", { parent: "5000", systemRole: "TAX_EXPENSE", note: "19.00", noteRef: "19.00" }),
  a("5410", "Current Tax", "EXPENSE", "5400"),
]

export async function seedChartOfAccounts(): Promise<void> {
  // Sequential, not Promise.all: a child's parentId comes from the row its
  // parent just created, and CHART is ordered parents-first for exactly
  // this reason.
  const idByCode = new Map<string, string>()
  /** What each account's contra was before this run, so an edit survives. */
  const linkedContra = new Map<string, string | null>()

  for (const entry of CHART) {
    const parentId = entry.parent ? idByCode.get(entry.parent) : undefined

    // Read before writing, so the update below can repair a *missing*
    // classification without overwriting a deliberate one.
    const existing = await prisma.account.findUnique({
      where: { code: entry.code },
      select: { noteRef: true, cashFlowKind: true, depreciationRate: true, contraAccountId: true },
    })

    const account = await prisma.account.upsert({
      where: { code: entry.code },
      // A re-run fills in what is missing and changes nothing else. A name or
      // a description somebody edited survives, and so does a cash-flow
      // section Finance moved on purpose — which matters because
      // `assertEveryAccountClassified` tells people to fix classification in
      // the chart of accounts, and for a seeded code a blanket overwrite here
      // would quietly undo them on the next deploy.
      update: {
        ...(existing?.noteRef ? {} : { noteRef: entry.noteRef ?? null }),
        ...(existing && existing.cashFlowKind !== "NONE"
          ? {}
          : { cashFlowKind: entry.cashFlow ?? "NONE" }),
        ...(existing?.depreciationRate
          ? {}
          : { depreciationRate: entry.rate ? new Prisma.Decimal(entry.rate) : null }),
      },
      create: {
        code: entry.code,
        name: entry.name,
        type: entry.type,
        parentId: parentId ?? null,
        isGroup: entry.isGroup ?? false,
        cashKind: entry.cashKind ?? "NONE",
        systemRole: entry.systemRole ?? null,
        noteRef: entry.noteRef ?? null,
        cashFlowKind: entry.cashFlow ?? "NONE",
        depreciationRate: entry.rate ? new Prisma.Decimal(entry.rate) : null,
        description: entry.note ? `Note ${entry.note} in the audited statements` : null,
      },
    })

    idByCode.set(entry.code, account.id)
    linkedContra.set(entry.code, existing?.contraAccountId ?? null)
  }

  // A second pass, because a contra link points at an account that may not
  // have existed when its cost account was created.
  for (const entry of CHART) {
    if (!entry.contra) continue
    // Left alone if something is already linked — the pairing is structural
    // (2b Decision 11) and re-pointing one is a deliberate act.
    if (linkedContra.get(entry.code)) continue

    const id = idByCode.get(entry.code)
    const contraId = idByCode.get(entry.contra)
    if (!id || !contraId) continue

    await prisma.account.update({
      where: { id },
      data: { contraAccountId: contraId },
    })
  }
}
