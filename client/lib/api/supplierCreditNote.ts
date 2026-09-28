import { apiFetch } from "./client"
import type { SupplierCreditNote } from "./types"

export interface SupplierCreditNoteInput {
  billId: string
  date: string
  reason: string
  lines: Array<{ billLineId: string; amount: string; vatAmount: string }>
}

export function listSupplierCreditNotes(accessToken: string): Promise<SupplierCreditNote[]> {
  return apiFetch<SupplierCreditNote[]>("/api/supplier-credit-notes", { accessToken })
}

export function createSupplierCreditNote(accessToken: string, input: SupplierCreditNoteInput): Promise<SupplierCreditNote> {
  return apiFetch<SupplierCreditNote>("/api/supplier-credit-notes", { method: "POST", accessToken, body: JSON.stringify(input) })
}

export function approveSupplierCreditNote(accessToken: string, id: string): Promise<SupplierCreditNote> {
  return apiFetch<SupplierCreditNote>(`/api/supplier-credit-notes/${id}/approve`, { method: "POST", accessToken })
}
