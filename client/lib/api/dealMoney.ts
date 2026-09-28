import { apiFetch } from "./client"
import type {
  DealMoney,
  DealMoneyListResult,
  DealSendBackKind,
  DealVatSummary,
  WaitingForApprovalRow,
} from "./types"

export interface DealMoneyListQuery {
  search?: string
  page?: number
}

/** Deals Won since go-live, newest first (`dealMoney.list.ts`). */
export function listDealMoney(accessToken: string, query: DealMoneyListQuery = {}): Promise<DealMoneyListResult> {
  const params = new URLSearchParams()
  if (query.search) params.set("search", query.search)
  if (query.page) params.set("page", String(query.page))
  const qs = params.toString()
  return apiFetch<DealMoneyListResult>(`/api/deal-money/deals${qs ? `?${qs}` : ""}`, { accessToken })
}

/**
 * One deal's Money section. Anyone signed in may call this — the server
 * checks deal access itself (`assertDealAccess`) before reading a figure.
 */
export function getDealMoney(accessToken: string, opportunityId: string): Promise<DealMoney> {
  return apiFetch<DealMoney>(`/api/deal-money/deals/${opportunityId}`, { accessToken })
}

/** Every draft invoice, bill and credit note waiting to be approved, oldest first. */
export function listWaitingForApproval(accessToken: string): Promise<WaitingForApprovalRow[]> {
  return apiFetch<WaitingForApprovalRow[]>("/api/deal-money/approvals", { accessToken })
}

/**
 * A Super Admin sends a draft back with a note instead of approving it.
 * Credit notes cannot be sent back (`DealSendBackKind` excludes them) — the
 * server refuses before this ever reaches the service.
 */
export function sendBackApproval(
  accessToken: string,
  kind: DealSendBackKind,
  id: string,
  note: string
): Promise<void> {
  return apiFetch<void>(`/api/deal-money/approvals/${kind}/${id}/send-back`, {
    method: "POST",
    accessToken,
    body: JSON.stringify({ note }),
  })
}

/** Not a VAT return — the app records VAT, it does not file it. */
export function getVatSummary(accessToken: string, from: string, to: string): Promise<DealVatSummary> {
  const params = new URLSearchParams({ from, to })
  return apiFetch<DealVatSummary>(`/api/deal-money/vat-summary?${params.toString()}`, { accessToken })
}
