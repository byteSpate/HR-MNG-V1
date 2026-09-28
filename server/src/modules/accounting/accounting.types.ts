/**
 * Shared shapes for the accounting module. Read models are declared here
 * rather than inferred from Prisma, because what the ledger returns is a
 * computed row, not a table row.
 */

import type { AccountCashKind, AccountType, Currency } from "../../generated/prisma/client"

/** A node in the chart-of-accounts tree, as the COA endpoint returns it. */
export interface AccountNode {
  id: string
  code: string
  name: string
  type: AccountType
  isGroup: boolean
  cashKind: AccountCashKind
  isActive: boolean
  systemRole: string | null
  description: string | null
  children: AccountNode[]
}

/** One dated movement in the General Ledger, Cash Book or Bank Book. */
export interface LedgerRow {
  journalId: string
  journalNo: string
  date: string
  narration: string
  lineNarration: string | null
  reference: string | null
  sourceModule: string | null
  debit: string
  credit: string
  /** Signed against the account's normal side, cumulative from `openingBalance`. */
  runningBalance: string
}

export interface LedgerResult {
  account: { id: string; code: string; name: string; type: AccountType }
  from: string
  to: string
  openingBalance: string
  rows: LedgerRow[]
  totalDebit: string
  totalCredit: string
  closingBalance: string
}

export interface TrialBalanceRow {
  accountId: string
  code: string
  name: string
  type: AccountType
  openingDebit: string
  openingCredit: string
  periodDebit: string
  periodCredit: string
  closingDebit: string
  closingCredit: string
}

export interface TrialBalanceResult {
  from: string
  to: string
  rows: TrialBalanceRow[]
  totals: {
    openingDebit: string
    openingCredit: string
    periodDebit: string
    periodCredit: string
    closingDebit: string
    closingCredit: string
  }
  /** False blocks financial-statement generation in slice 2. */
  isBalanced: boolean
}

/**
 * The seam other modules post through. Accounts are addressed by `code`, so
 * a caller holds "5110" and never an Account uuid it would have to look up
 * and cache.
 */
export interface SystemJournalInput {
  /** Truncated to its UTC day by `postSystemJournal`; pass a timestamp freely. */
  date: Date
  narration: string
  reference?: string
  source: { module: string; refId: string; event: string }
  lines: Array<{
    accountCode: string
    debit?: string
    credit?: string
    departmentId?: string
    employeeId?: string
    // ── deal-based dimensions, added for receivables & payables ──
    opportunityId?: string
    customerId?: string
    supplierId?: string
    narration?: string
    /**
     * Provenance of a converted figure, memo only — the `JournalLine` columns
     * of the same names. Omitted when the transaction was already BDT.
     * Nothing computes from these; they exist so a line reading 61,25,000 can
     * answer "why?" with "USD 50,000 at 122.50".
     */
    sourceCurrency?: Currency
    sourceAmount?: string
    fxRateToBdt?: string
  }>
  createdBy: string
}
