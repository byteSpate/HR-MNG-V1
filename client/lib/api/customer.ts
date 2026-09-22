import { apiFetch } from "./client"
import type { Customer } from "./types"

export function listCustomers(accessToken: string): Promise<Customer[]> {
  return apiFetch<Customer[]>("/api/customers", { accessToken })
}

export function createCustomer(
  accessToken: string,
  input: { legalName: string; billingAddress?: string; bin?: string; paymentDays?: number }
): Promise<Customer> {
  return apiFetch<Customer>("/api/customers", {
    method: "POST",
    accessToken,
    body: JSON.stringify(input),
  })
}

export function updateCustomer(
  accessToken: string,
  id: string,
  input: { legalName: string; billingAddress?: string; bin?: string; paymentDays?: number }
): Promise<Customer> {
  return apiFetch<Customer>(`/api/customers/${id}`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(input),
  })
}
