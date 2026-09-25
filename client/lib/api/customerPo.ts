import { apiFetch } from "./client"
import type { CustomerPo, PrefillLine, SaleLineKind } from "./types"

export interface CustomerPoInput {
  opportunityId: string
  customerPoNumber: string
  date: string
  invoiceTo?: string
  lines: Array<{
    description: string
    kind: SaleLineKind
    quantity: string
    unitPrice: string
    vatCodeId: string
  }>
}

export function listCustomerPos(
  accessToken: string,
  filter: { opportunityId?: string; status?: string } = {}
): Promise<CustomerPo[]> {
  const params = new URLSearchParams()
  if (filter.opportunityId) params.set("opportunityId", filter.opportunityId)
  if (filter.status) params.set("status", filter.status)
  const qs = params.toString()
  return apiFetch<CustomerPo[]>(`/api/customer-pos${qs ? `?${qs}` : ""}`, { accessToken })
}

export function getCustomerPo(accessToken: string, id: string): Promise<CustomerPo> {
  return apiFetch<CustomerPo>(`/api/customer-pos/${id}`, { accessToken })
}

export function prefillPoLines(accessToken: string, opportunityId: string): Promise<{ lines: PrefillLine[] }> {
  return apiFetch<{ lines: PrefillLine[] }>(`/api/customer-pos/prefill/${opportunityId}`, { accessToken })
}

export function createCustomerPo(accessToken: string, input: CustomerPoInput): Promise<CustomerPo> {
  return apiFetch<CustomerPo>("/api/customer-pos", { method: "POST", accessToken, body: JSON.stringify(input) })
}

export function updateCustomerPo(accessToken: string, id: string, input: Omit<CustomerPoInput, "opportunityId">): Promise<CustomerPo> {
  return apiFetch<CustomerPo>(`/api/customer-pos/${id}`, { method: "PATCH", accessToken, body: JSON.stringify(input) })
}

export function cancelCustomerPo(accessToken: string, id: string, reason: string): Promise<CustomerPo> {
  return apiFetch<CustomerPo>(`/api/customer-pos/${id}/cancel`, { method: "POST", accessToken, body: JSON.stringify({ reason }) })
}
