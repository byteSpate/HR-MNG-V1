import { apiFetch } from "../client"
import type {
  SalesDashboardPayload,
} from "../types"

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
