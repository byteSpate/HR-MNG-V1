import { apiFetch } from "./client"
import type { Receipt } from "./types"

export interface ReceiptInput {
  customerId: string
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
  openingAllocation?: { amount: string }
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

export function createReceipt(accessToken: string, input: ReceiptInput): Promise<Receipt> {
  return apiFetch<Receipt>("/api/receipts", { method: "POST", accessToken, body: JSON.stringify(input) })
}

export function approveReceipt(accessToken: string, id: string): Promise<Receipt> {
  return apiFetch<Receipt>(`/api/receipts/${id}/approve`, { method: "POST", accessToken })
}

export function updateReceiptCertificates(accessToken: string, id: string, input: CertificatesInput): Promise<Receipt> {
  return apiFetch<Receipt>(`/api/receipts/${id}/certificates`, { method: "PATCH", accessToken, body: JSON.stringify(input) })
}

export function matchCustomerAdvance(
  accessToken: string,
  id: string,
  input: { invoiceId?: string; openingBalanceId?: string; amount: string }
): Promise<unknown> {
  return apiFetch<unknown>(`/api/receipts/${id}/match-advance`, { method: "POST", accessToken, body: JSON.stringify(input) })
}
