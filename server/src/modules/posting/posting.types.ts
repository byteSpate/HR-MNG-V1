export type PostingEvent =
  | "PAYROLL_ACCRUAL" | "PAYROLL_PAYMENT" | "EXPENSE_ACCRUAL"
  | "COST_ACCRUAL" | "COST_PAYMENT"
  | "SETTLEMENT_ACCRUAL" | "SETTLEMENT_PAYMENT"
  | "ASSET_ACQUISITION" | "ASSET_PAYMENT" | "ASSET_DEPRECIATION" | "ASSET_DISPOSAL"
  // Receivables & payables, Phase 1. No caller yet — Phase 2/3 write the
  // posting builders that use these, the same way postSystemJournal itself
  // shipped with no caller in slice 1.
  | "SUPPLIER_BILL" | "SUPPLIER_PAYMENT" | "SUPPLIER_CREDIT"
  | "INVOICE" | "EARNED" | "COST_RELEASE" | "RECEIPT" | "CUSTOMER_CREDIT" | "FX"
export const POSTING_EVENTS: PostingEvent[] = [
  "PAYROLL_ACCRUAL", "PAYROLL_PAYMENT", "EXPENSE_ACCRUAL",
  "COST_ACCRUAL", "COST_PAYMENT",
  "SETTLEMENT_ACCRUAL", "SETTLEMENT_PAYMENT",
  "ASSET_ACQUISITION", "ASSET_PAYMENT", "ASSET_DEPRECIATION", "ASSET_DISPOSAL",
  "SUPPLIER_BILL", "SUPPLIER_PAYMENT", "SUPPLIER_CREDIT",
  "INVOICE", "EARNED", "COST_RELEASE", "RECEIPT", "CUSTOMER_CREDIT", "FX",
]
export interface ResolvedRules { event: PostingEvent; byKey: Map<string, string> }
