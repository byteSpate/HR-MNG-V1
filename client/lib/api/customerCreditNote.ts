import { apiFetch } from "./client"
import type { CustomerCreditNote } from "./types"

export interface CustomerCreditNoteInput {
  invoiceId: string
  date: string
  reason: string
  lines: Array<{ invoiceLineId: string; amount: string }>
}

export function listCustomerCreditNotes(accessToken: string): Promise<CustomerCreditNote[]> {
  return apiFetch<CustomerCreditNote[]>("/api/customer-credit-notes", { accessToken })
}

export function createCustomerCreditNote(accessToken: string, input: CustomerCreditNoteInput): Promise<CustomerCreditNote> {
  return apiFetch<CustomerCreditNote>("/api/customer-credit-notes", { method: "POST", accessToken, body: JSON.stringify(input) })
}

export function approveCustomerCreditNote(accessToken: string, id: string): Promise<CustomerCreditNote> {
  return apiFetch<CustomerCreditNote>(`/api/customer-credit-notes/${id}/approve`, { method: "POST", accessToken })
}
