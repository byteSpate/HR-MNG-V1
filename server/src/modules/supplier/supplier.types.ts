export interface SupplierSummary {
  id: string
  name: string
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  bin: string | null
  paymentDays: number
  isActive: boolean
  createdAt: Date
}
