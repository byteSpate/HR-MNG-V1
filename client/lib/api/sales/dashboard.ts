import { apiFetch } from "../client"
import type {
  HeatmapOverview,
  SalesDashboardPayload,
} from "../types"

/** The Heatmap band. The same `employeeId` rules as the dashboard: a uuid, or "all". */
export function getHeatmapOverview(accessToken: string, employeeId?: string): Promise<HeatmapOverview> {
  const search = new URLSearchParams()
  if (employeeId) search.set("employeeId", employeeId)
  const qs = search.toString()
  return apiFetch<HeatmapOverview>(`/api/sales/dashboard/heatmap${qs ? `?${qs}` : ""}`, { accessToken })
}

/** `employeeId` is a uuid, or the literal "all" for the team roll-up. */
export function getSalesDashboard(
  accessToken: string,
  employeeId?: string
): Promise<SalesDashboardPayload> {
  const search = new URLSearchParams()
  if (employeeId) search.set("employeeId", employeeId)
  const qs = search.toString()
  return apiFetch<SalesDashboardPayload>(`/api/sales/dashboard${qs ? `?${qs}` : ""}`, {
    accessToken,
  })
}
