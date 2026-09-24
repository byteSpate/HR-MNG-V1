import { apiFetch } from "./client"
import type { EarningEvent } from "./types"

export interface EarningEventInput {
  poId: string
  kind: "DELIVERY" | "ACCEPTANCE"
  date: string
  evidenceRef: string
  note?: string
  lines: Array<{ poLineId: string; quantity?: string; amount?: string }>
}

export function listEarningEvents(
  accessToken: string,
  filter: { status?: string; poId?: string; opportunityId?: string } = {}
): Promise<EarningEvent[]> {
  const params = new URLSearchParams()
  if (filter.status) params.set("status", filter.status)
  if (filter.poId) params.set("poId", filter.poId)
  if (filter.opportunityId) params.set("opportunityId", filter.opportunityId)
  const qs = params.toString()
  return apiFetch<EarningEvent[]>(`/api/earning-events${qs ? `?${qs}` : ""}`, { accessToken })
}

export function getEarningEvent(accessToken: string, id: string): Promise<EarningEvent> {
  return apiFetch<EarningEvent>(`/api/earning-events/${id}`, { accessToken })
}

export function createEarningEvent(accessToken: string, input: EarningEventInput): Promise<EarningEvent> {
  return apiFetch<EarningEvent>("/api/earning-events", { method: "POST", accessToken, body: JSON.stringify(input) })
}

export function approveEarningEvent(accessToken: string, id: string): Promise<EarningEvent> {
  return apiFetch<EarningEvent>(`/api/earning-events/${id}/approve`, { method: "POST", accessToken })
}
