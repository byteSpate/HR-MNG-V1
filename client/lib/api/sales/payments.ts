import { apiFetch } from "../client"
import type { PaymentsTable } from "../types"

/** A Payments table, for Sales Admins and Super Admins (owner, 2026-10-18). */
export function listPayments(
  accessToken: string,
  filter: { accountId?: string; opportunityId?: string; open?: boolean }
): Promise<PaymentsTable> {
  const search = new URLSearchParams()
  if (filter.accountId) search.set("accountId", filter.accountId)
  if (filter.opportunityId) search.set("opportunityId", filter.opportunityId)
  if (filter.open) search.set("open", "true")
  const qs = search.toString()
  return apiFetch<PaymentsTable>(`/api/sales/payments${qs ? `?${qs}` : ""}`, { accessToken })
}
