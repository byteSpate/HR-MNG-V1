import { apiFetch } from "./client"
import type { Supplier } from "./types"

export function listSuppliers(accessToken: string): Promise<Supplier[]> {
  return apiFetch<Supplier[]>("/api/suppliers", { accessToken })
}

export function createSupplier(
  accessToken: string,
  input: {
    name: string
    contactName?: string
    contactPhone?: string
    contactEmail?: string
    bin?: string
    paymentDays?: number
  }
): Promise<Supplier> {
  return apiFetch<Supplier>("/api/suppliers", {
    method: "POST",
    accessToken,
    body: JSON.stringify(input),
  })
}

export function updateSupplier(
  accessToken: string,
  id: string,
  input: {
    name: string
    contactName?: string
    contactPhone?: string
    contactEmail?: string
    bin?: string
    paymentDays?: number
  }
): Promise<Supplier> {
  return apiFetch<Supplier>(`/api/suppliers/${id}`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(input),
  })
}

export function deactivateSupplier(accessToken: string, id: string): Promise<Supplier> {
  return apiFetch<Supplier>(`/api/suppliers/${id}/deactivate`, {
    method: "POST",
    accessToken,
  })
}

export function reactivateSupplier(accessToken: string, id: string): Promise<Supplier> {
  return apiFetch<Supplier>(`/api/suppliers/${id}/reactivate`, {
    method: "POST",
    accessToken,
  })
}
