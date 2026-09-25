import { apiFetch } from "./client"
import type { Receipt } from "./types"

export interface ReceiptInput {
  // The one deal this receipt belongs to (spec: every document belongs to
  // one deal). No customerId: it is derived from the deal's customer, never
  // taken from the caller.
  opportunityId: string
  date: string
  amount: string
  vdsAmount?: string
  vdsCertificateRef?: string
  vdsCertificateDate?: string
  aitAmount?: string
  aitCertificateRef?: string
  aitCertificateDate?: string
  reference?: string
  allocations: Array<{ invoiceId: string; amount: string }>
}

export interface CertificatesInput {
  vdsCertificateRef?: string | null
  vdsCertificateDate?: string | null
  aitCertificateRef?: string | null
  aitCertificateDate?: string | null
}

export function listReceipts(accessToken: string, filter: { certificates?: "missing" } = {}): Promise<Receipt[]> {
  const params = new URLSearchParams()
  if (filter.certificates) params.set("certificates", filter.certificates)
  const qs = params.toString()
  return apiFetch<Receipt[]>(`/api/receipts${qs ? `?${qs}` : ""}`, { accessToken })
}

export function getReceipt(accessToken: string, id: string): Promise<Receipt> {
  return apiFetch<Receipt>(`/api/receipts/${id}`, { accessToken })
}

/** A receipt posts and is saved APPROVED in the same step — there is no
 *  separate draft/approve lifecycle any more. A mistake is corrected with
 *  `reverseReceipt`, not a second approver. */
export function createReceipt(accessToken: string, input: ReceiptInput): Promise<Receipt> {
  return apiFetch<Receipt>("/api/receipts", { method: "POST", accessToken, body: JSON.stringify(input) })
}

export function updateReceiptCertificates(accessToken: string, id: string, input: CertificatesInput): Promise<Receipt> {
  return apiFetch<Receipt>(`/api/receipts/${id}/certificates`, { method: "PATCH", accessToken, body: JSON.stringify(input) })
}

/** Super Admin only. Corrects an approved receipt by reversing its posted journal. */
export function reverseReceipt(accessToken: string, id: string, reason: string): Promise<Receipt> {
  return apiFetch<Receipt>(`/api/receipts/${id}/reverse`, { method: "POST", accessToken, body: JSON.stringify({ reason }) })
}
