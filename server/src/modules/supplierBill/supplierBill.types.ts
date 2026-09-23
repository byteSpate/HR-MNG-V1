export interface SupplierBillLineSummary {
  id: string
  description: string
  kind: "GOODS" | "SERVICE"
  amount: string
  sourceAmount: string | null
  vatCodeId: string
  vatAmount: string
  opportunityId: string
}

export interface SupplierBillSummary {
  id: string
  supplierId: string
  billNumber: string
  date: Date
  dueDate: Date
  currency: "BDT" | "USD"
  status: "DRAFT" | "APPROVED"
  total: string
}

export interface SupplierBillDetail extends SupplierBillSummary {
  fxRateToBdt: string | null
  lines: SupplierBillLineSummary[]
  approvedBy: string | null
  approvedAt: Date | null
}
