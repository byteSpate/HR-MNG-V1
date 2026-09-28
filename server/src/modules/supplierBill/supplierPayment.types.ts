export interface SupplierPaymentAllocationSummary {
  billId: string
  amount: string
}

export interface SupplierPaymentSummary {
  id: string
  supplierId: string
  date: Date
  amount: string
  currency: "BDT" | "USD"
  status: "DRAFT" | "APPROVED"
  reference: string | null
  allocations: SupplierPaymentAllocationSummary[]
}
