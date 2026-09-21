import { apiFetch } from "../client"
import type {
  AccountHistory,
  CreateSalesAccountBody,
  CreateSalesContactBody,
  LogCommunicationBody,
  SalesAccountSummary,
  SalesCommunicationSummary,
  SalesContactSummary,
  SalesEligibleEmployee,
  SetContactStatusBody,
  SalesAccountMargin,
  UpdateSalesAccountBody,
  TimelineItem,
} from "../types"

/** "My Accounts" — owner, assignee, or admin. */
export function listSalesAccounts(accessToken: string, unverified = false): Promise<SalesAccountSummary[]> {
  return apiFetch<SalesAccountSummary[]>(`/api/sales/accounts${unverified ? "?unverified=true" : ""}`, { accessToken })
}

/** "All Accounts" — the shared, read-only directory: every account, to every
    Sales Hub member, with `canManage` telling the client which ones the
    viewer can actually work rather than merely see. */
export function listAllSalesAccounts(accessToken: string, unverified = false, ownerEmployeeId?: string): Promise<SalesAccountSummary[]> {
  const search = new URLSearchParams({ scope: "all" })
  if (unverified) search.set("unverified", "true")
  if (ownerEmployeeId) search.set("ownerEmployeeId", ownerEmployeeId)
  return apiFetch<SalesAccountSummary[]>(`/api/sales/accounts?${search.toString()}`, { accessToken })
}

/** Sales Admin only — the same people the create-account form's owner and
    collaborator pickers may offer. */
export function listSalesEligibleEmployees(accessToken: string): Promise<SalesEligibleEmployee[]> {
  return apiFetch<SalesEligibleEmployee[]>("/api/sales/employees", { accessToken })
}

export function getSalesAccount(accessToken: string, id: string): Promise<SalesAccountSummary> {
  return apiFetch<SalesAccountSummary>(`/api/sales/accounts/${id}`, { accessToken })
}

/** The margin won on an account. Only for the people who work it; anybody else gets a 404. */
export function getAccountMargin(accessToken: string, id: string): Promise<SalesAccountMargin> {
  return apiFetch<SalesAccountMargin>(`/api/sales/accounts/${id}/margin`, { accessToken })
}

export function createSalesAccount(
  accessToken: string,
  body: CreateSalesAccountBody
): Promise<SalesAccountSummary> {
  return apiFetch<SalesAccountSummary>("/api/sales/accounts", {
    method: "POST",
    accessToken,
    body: JSON.stringify(body),
  })
}

export function listContacts(accessToken: string, accountId: string): Promise<SalesContactSummary[]> {
  return apiFetch<SalesContactSummary[]>(`/api/sales/accounts/${accountId}/contacts`, { accessToken })
}

export function addContact(
  accessToken: string,
  accountId: string,
  body: CreateSalesContactBody
): Promise<SalesContactSummary> {
  return apiFetch<SalesContactSummary>(`/api/sales/accounts/${accountId}/contacts`, {
    method: "POST",
    accessToken,
    body: JSON.stringify(body),
  })
}

export function setPrimaryContact(accessToken: string, contactId: string): Promise<SalesContactSummary> {
  return apiFetch<SalesContactSummary>(`/api/sales/contacts/${contactId}/primary`, {
    method: "PATCH",
    accessToken,
  })
}

export function setContactStatus(
  accessToken: string,
  contactId: string,
  body: SetContactStatusBody
): Promise<SalesContactSummary> {
  return apiFetch<SalesContactSummary>(`/api/sales/contacts/${contactId}/status`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(body),
  })
}

export function getAccountTimeline(
  accessToken: string,
  accountId: string
): Promise<{ items: TimelineItem[] }> {
  return apiFetch<{ items: TimelineItem[] }>(`/api/sales/accounts/${accountId}/timeline`, { accessToken })
}

export function logCommunication(
  accessToken: string,
  accountId: string,
  body: LogCommunicationBody
): Promise<SalesCommunicationSummary> {
  return apiFetch<SalesCommunicationSummary>(`/api/sales/accounts/${accountId}/communications`, {
    method: "POST",
    accessToken,
    body: JSON.stringify(body),
  })
}

export function getAccountHistory(
  accessToken: string,
  accountId: string
): Promise<AccountHistory> {
  return apiFetch<AccountHistory>(`/api/sales/accounts/${accountId}/history`, { accessToken })
}

// ── Phase 2 ───────────────────────────────────────────────────────────────

export function updateSalesAccount(
  accessToken: string,
  id: string,
  body: UpdateSalesAccountBody
): Promise<SalesAccountSummary> {
  return apiFetch<SalesAccountSummary>(`/api/sales/accounts/${id}`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(body),
  })
}
