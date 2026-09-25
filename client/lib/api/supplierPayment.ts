import { apiFetch } from "./client"
import type { SupplierPayment } from "./types"

/** Amount and allocations are in the payment's own currency; the server
 *  converts a USD payment to taka at the payment-date rate. */
export interface SupplierPaymentInput {
  // The one deal this payment belongs to (spec: every document belongs to
  // one deal).
  opportunityId: string
  supplierId: string
  date: string
  amount: string
  currency: "BDT" | "USD"
  reference?: string
  allocations: Array<{ billId: string; amount: string }>
}

export function listSupplierPayments(accessToken: string): Promise<SupplierPayment[]> {
  return apiFetch<SupplierPayment[]>("/api/supplier-payments", { accessToken })
}

export function getSupplierPayment(accessToken: string, id: string): Promise<SupplierPayment> {
  return apiFetch<SupplierPayment>(`/api/supplier-payments/${id}`, { accessToken })
}

/** A payment posts and is saved APPROVED in the same step — there is no
 *  separate draft/approve lifecycle any more. A mistake is corrected with
 *  `reverseSupplierPayment`, not a second approver. */
export function createSupplierPayment(accessToken: string, input: SupplierPaymentInput): Promise<SupplierPayment> {
  return apiFetch<SupplierPayment>("/api/supplier-payments", { method: "POST", accessToken, body: JSON.stringify(input) })
}

/** Super Admin only. Corrects an approved payment by reversing its posted journal. */
export function reverseSupplierPayment(accessToken: string, id: string, reason: string): Promise<SupplierPayment> {
  return apiFetch<SupplierPayment>(`/api/supplier-payments/${id}/reverse`, {
    method: "POST",
    accessToken,
    body: JSON.stringify({ reason }),
  })
}
