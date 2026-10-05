import { apiFetch } from "../client"
import type { SalesEligibleEmployee, SalesRemovalRequest, SalesRemovalStatus } from "../types"

export function listCollaboratorOptions(accessToken: string, accountId: string): Promise<SalesEligibleEmployee[]> {
  return apiFetch<SalesEligibleEmployee[]>(`/api/sales/accounts/${accountId}/collaborator-options`, { accessToken })
}

export function addCollaborator(accessToken: string, accountId: string, employeeId: string): Promise<{ id: string; fullName: string }> {
  return apiFetch(`/api/sales/accounts/${accountId}/collaborators`, {
    method: "POST",
    accessToken,
    body: JSON.stringify({ employeeId }),
  })
}

/** A Sales Admin only. Removes at once. */
export function removeCollaborator(accessToken: string, accountId: string, employeeId: string): Promise<void> {
  return apiFetch<void>(`/api/sales/accounts/${accountId}/collaborators/${employeeId}`, { method: "DELETE", accessToken })
}

export function listRemovalRequests(
  accessToken: string,
  query: { accountId?: string; status?: SalesRemovalStatus } = {}
): Promise<{ items: SalesRemovalRequest[] }> {
  const search = new URLSearchParams()
  if (query.accountId) search.set("accountId", query.accountId)
  if (query.status) search.set("status", query.status)
  const qs = search.toString()
  return apiFetch<{ items: SalesRemovalRequest[] }>(`/api/sales/removal-requests${qs ? `?${qs}` : ""}`, { accessToken })
}

export function requestRemoval(accessToken: string, accountId: string, employeeId: string): Promise<SalesRemovalRequest> {
  return apiFetch<SalesRemovalRequest>(`/api/sales/accounts/${accountId}/removal-requests`, {
    method: "POST",
    accessToken,
    body: JSON.stringify({ employeeId }),
  })
}

export function cancelRemovalRequest(accessToken: string, id: string): Promise<SalesRemovalRequest> {
  return apiFetch<SalesRemovalRequest>(`/api/sales/removal-requests/${id}/cancel`, { method: "PATCH", accessToken })
}

export function approveRemovalRequest(accessToken: string, id: string): Promise<SalesRemovalRequest> {
  return apiFetch<SalesRemovalRequest>(`/api/sales/removal-requests/${id}/approve`, { method: "PATCH", accessToken })
}

export function refuseRemovalRequest(accessToken: string, id: string, reason: string): Promise<SalesRemovalRequest> {
  return apiFetch<SalesRemovalRequest>(`/api/sales/removal-requests/${id}/refuse`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify({ reason }),
  })
}
