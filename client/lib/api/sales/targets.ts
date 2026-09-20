import { apiFetch } from "../client"
import type {
  SalesTargetYear,
  SetSalesTargetBody,
} from "../types"

export function getSalesTargetYear(
  accessToken: string,
  calendarYear: number,
  employeeId?: string
): Promise<SalesTargetYear> {
  const search = new URLSearchParams({ calendarYear: String(calendarYear) })
  if (employeeId) search.set("employeeId", employeeId)
  return apiFetch<SalesTargetYear>(`/api/sales/targets?${search.toString()}`, { accessToken })
}

export function setSalesTarget(
  accessToken: string,
  body: SetSalesTargetBody
): Promise<SalesTargetYear> {
  // The whole year comes back: changing the amount or the start quarter moves
  // every quarter's target at once.
  return apiFetch<SalesTargetYear>("/api/sales/targets", {
    method: "PUT",
    accessToken,
    body: JSON.stringify(body),
  })
}
