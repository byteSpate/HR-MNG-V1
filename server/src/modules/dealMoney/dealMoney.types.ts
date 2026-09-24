import type { Prisma } from "../../generated/prisma/client"
import { PO_INCLUDE } from "../receivables/customerPo.service"
import { INVOICE_INCLUDE } from "../receivables/invoice.service"
import { RECEIPT_INCLUDE } from "../receivables/receipt.service"

// The Money section's own includes, built from each document's existing
// include (spec: "Reuse the existing includes") plus the relations this
// one payload needs beyond what any single existing page needed: an
// invoice's credit notes and settled allocations, a bill's supplier and
// credit notes, a payment's allocations.

export const DEAL_INVOICE_INCLUDE = {
  ...INVOICE_INCLUDE,
  allocations: { where: { receipt: { status: "APPROVED" } }, select: { amount: true } },
  creditNotes: { include: { lines: true } },
} satisfies Prisma.InvoiceInclude

export const DEAL_BILL_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  lines: true,
  allocations: { where: { payment: { status: "APPROVED" } }, select: { amount: true } },
  creditNotes: { include: { lines: true } },
} satisfies Prisma.SupplierBillInclude

export const DEAL_PAYMENT_INCLUDE = {
  allocations: { include: { bill: { select: { id: true, billNumber: true } } } },
} satisfies Prisma.SupplierPaymentInclude

export type CustomerPoRow = Prisma.CustomerPoGetPayload<{ include: typeof PO_INCLUDE }>
export type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof DEAL_INVOICE_INCLUDE }>
export type ReceiptRow = Prisma.ReceiptGetPayload<{ include: typeof RECEIPT_INCLUDE }>
export type SupplierBillRow = Prisma.SupplierBillGetPayload<{ include: typeof DEAL_BILL_INCLUDE }>
export type SupplierPaymentRow = Prisma.SupplierPaymentGetPayload<{ include: typeof DEAL_PAYMENT_INCLUDE }>

export interface MoneyNumbers {
  sold: string
  stillOwed: string
  cost: string | null
  profit: string | null
}

export interface DealMoney {
  deal: {
    id: string
    serial: string
    name: string
    customer: { id: string; legalName: string; billingAddress: string | null; paymentDays: number } | null
  }
  canSeeCost: boolean
  canEdit: boolean
  numbers: MoneyNumbers
  pos: CustomerPoRow[]
  bills: SupplierBillRow[] | null
  supplierPayments: SupplierPaymentRow[] | null
  invoices: InvoiceRow[]
  receipts: ReceiptRow[]
  productLines: Array<{
    id: string
    product: string
    model: string | null
    quantity: number | null
    supplier: { id: string; name: string } | null
  }>
}
