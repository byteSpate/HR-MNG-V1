import { apiFetch } from "./client"
import type { Invoice, InvoiceablePo } from "./types"

export interface InvoiceInput {
  poId: string
  invoiceNumber: string
  date: string
  dueDate?: string
  lines: Array<{ poLineId: string; description?: string; amount: string; vatCodeId?: string }>
}

export function listInvoices(accessToken: string, filter: { status?: string } = {}): Promise<Invoice[]> {
  const params = new URLSearchParams()
  if (filter.status) params.set("status", filter.status)
  const qs = params.toString()
  return apiFetch<Invoice[]>(`/api/invoices${qs ? `?${qs}` : ""}`, { accessToken })
}

export function getInvoice(accessToken: string, id: string): Promise<Invoice> {
  return apiFetch<Invoice>(`/api/invoices/${id}`, { accessToken })
}

export function listInvoiceablePos(accessToken: string): Promise<InvoiceablePo[]> {
  return apiFetch<InvoiceablePo[]>("/api/invoices/pos", { accessToken })
}

export function createInvoice(accessToken: string, input: InvoiceInput): Promise<Invoice> {
  return apiFetch<Invoice>("/api/invoices", { method: "POST", accessToken, body: JSON.stringify(input) })
}

export function updateInvoice(accessToken: string, id: string, input: Omit<InvoiceInput, "poId">): Promise<Invoice> {
  return apiFetch<Invoice>(`/api/invoices/${id}`, { method: "PATCH", accessToken, body: JSON.stringify(input) })
}

export function approveInvoice(accessToken: string, id: string): Promise<Invoice> {
  return apiFetch<Invoice>(`/api/invoices/${id}/approve`, { method: "POST", accessToken })
}
