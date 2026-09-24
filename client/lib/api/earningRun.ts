import { apiFetch } from "./client"
import type { EarningRun } from "./types"

export function listEarningRuns(accessToken: string): Promise<EarningRun[]> {
  return apiFetch<EarningRun[]>("/api/earning-runs", { accessToken })
}

export function draftEarningRun(accessToken: string, input: { year: number; month: number }): Promise<EarningRun> {
  return apiFetch<EarningRun>("/api/earning-runs", { method: "POST", accessToken, body: JSON.stringify(input) })
}

export function getEarningRun(accessToken: string, id: string): Promise<EarningRun> {
  return apiFetch<EarningRun>(`/api/earning-runs/${id}`, { accessToken })
}

export function postEarningRun(accessToken: string, id: string): Promise<EarningRun> {
  return apiFetch<EarningRun>(`/api/earning-runs/${id}/post`, { method: "POST", accessToken })
}

export function reverseEarningRun(accessToken: string, id: string, reason: string): Promise<EarningRun> {
  return apiFetch<EarningRun>(`/api/earning-runs/${id}/reverse`, { method: "POST", accessToken, body: JSON.stringify({ reason }) })
}

export function deleteEarningRun(accessToken: string, id: string): Promise<void> {
  return apiFetch<void>(`/api/earning-runs/${id}`, { method: "DELETE", accessToken })
}
