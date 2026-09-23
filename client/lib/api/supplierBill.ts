import { apiFetch } from "./client"
import type { BillableOpportunity, SupplierAgeingRow, SupplierBill, SupplierControlTieOut } from "./types"

export interface SupplierBillLineInput {
  description: string
  kind: "GOODS" | "SERVICE"
  amount: string
  sourceAmount?: string
  vatCodeId: string
  opportunityId: string
}

export interface SupplierBillInput {
  supplierId: string
  billNumber: string
  date: string
  dueDate: string
  currency: "BDT" | "USD"
  lines: SupplierBillLineInput[]
}

export function listSupplierBills(accessToken: string): Promise<SupplierBill[]> {
  return apiFetch<SupplierBill[]>("/api/supplier-bills", { accessToken })
}

export function getSupplierBill(accessToken: string, id: string): Promise<SupplierBill> {
  return apiFetch<SupplierBill>(`/api/supplier-bills/${id}`, { accessToken })
}

export function createSupplierBill(accessToken: string, input: SupplierBillInput): Promise<SupplierBill> {
  return apiFetch<SupplierBill>("/api/supplier-bills", { method: "POST", accessToken, body: JSON.stringify(input) })
}

export function updateSupplierBill(accessToken: string, id: string, input: SupplierBillInput): Promise<SupplierBill> {
  return apiFetch<SupplierBill>(`/api/supplier-bills/${id}`, { method: "PATCH", accessToken, body: JSON.stringify(input) })
}

export function approveSupplierBill(accessToken: string, id: string): Promise<SupplierBill> {
  return apiFetch<SupplierBill>(`/api/supplier-bills/${id}/approve`, { method: "POST", accessToken })
}

export function listBillableOpportunities(accessToken: string): Promise<BillableOpportunity[]> {
  return apiFetch<BillableOpportunity[]>("/api/supplier-bills/opportunities", { accessToken })
}

export function getSupplierAgeing(accessToken: string): Promise<SupplierAgeingRow[]> {
  return apiFetch<SupplierAgeingRow[]>("/api/supplier-bills/reports/ageing", { accessToken })
}

export function getSupplierControlTieOut(accessToken: string): Promise<SupplierControlTieOut> {
  return apiFetch<SupplierControlTieOut>("/api/supplier-bills/reports/tie-out", { accessToken })
}
