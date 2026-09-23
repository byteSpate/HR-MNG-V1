import { apiFetch } from "./client"
import type { SupplierPayment } from "./types"

export interface SupplierPaymentInput {
  supplierId: string
  date: string
  amount: string
  sourceAmount?: string
  currency: "BDT" | "USD"
  reference?: string
  allocations: Array<{ billId: string; amount: string }>
}

export function listSupplierPayments(accessToken: string): Promise<SupplierPayment[]> {
  return apiFetch<SupplierPayment[]>("/api/supplier-payments", { accessToken })
}

export function createSupplierPayment(accessToken: string, input: SupplierPaymentInput): Promise<SupplierPayment> {
  return apiFetch<SupplierPayment>("/api/supplier-payments", { method: "POST", accessToken, body: JSON.stringify(input) })
}

export function approveSupplierPayment(accessToken: string, id: string): Promise<SupplierPayment> {
  return apiFetch<SupplierPayment>(`/api/supplier-payments/${id}/approve`, { method: "POST", accessToken })
}

export function matchAdvance(accessToken: string, id: string, input: { billId: string; amount: string }): Promise<unknown> {
  return apiFetch<unknown>(`/api/supplier-payments/${id}/match-advance`, {
    method: "POST",
    accessToken,
    body: JSON.stringify(input),
  })
}
