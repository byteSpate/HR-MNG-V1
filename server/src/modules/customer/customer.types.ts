/** The Customer module's shared shapes, distinct from the Zod-inferred input
 *  types in customer.validators.ts. */

export interface CustomerSummary {
  id: string
  legalName: string
  billingAddress: string | null
  bin: string | null
  paymentDays: number
  salesAccountId: string | null
  createdAt: Date
}
