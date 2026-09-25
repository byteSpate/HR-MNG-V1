export interface SupplierCreditNoteLineSummary {
  billLineId: string
  amount: string
  vatAmount: string
}

export interface SupplierCreditNoteSummary {
  id: string
  billId: string
  supplierId: string
  date: Date
  reason: string
  status: "DRAFT" | "APPROVED"
  lines: SupplierCreditNoteLineSummary[]
}
