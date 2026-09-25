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

/**
 * Adds a supplier by name only, from the Sales Hub product line form — a
 * lightweight convenience during data entry, distinct from `createSupplier`
 * above, which still owns contact details, BIN and the audit trail.
 */
export function quickAddSupplier(accessToken: string, name: string): Promise<{ id: string; name: string }> {
  return apiFetch<{ id: string; name: string }>("/api/suppliers/quick", {
    method: "POST",
    accessToken,
    body: JSON.stringify({ name }),
  })
}

/** "Did you mean?" while typing a new supplier's name. */
export function findSimilarSuppliers(accessToken: string, q: string): Promise<Array<{ id: string; name: string }>> {
  const params = new URLSearchParams({ q })
  return apiFetch<Array<{ id: string; name: string }>>(`/api/suppliers/similar?${params.toString()}`, { accessToken })
}

/** Active suppliers only, for a product line's supplier picker. */
export function listSupplierOptions(accessToken: string): Promise<Array<{ id: string; name: string }>> {
  return apiFetch<Array<{ id: string; name: string }>>("/api/suppliers/options", { accessToken })
}
