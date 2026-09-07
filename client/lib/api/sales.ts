import { apiFetch } from "./client"
import type {
  AccountHistoryEntry,
  CreateSalesAccountBody,
  CreateSalesContactBody,
  LogCommunicationBody,
  SalesAccountSummary,
  SalesCommunicationSummary,
  SalesContactSummary,
  SetContactStatusBody,
  TimelineItem,
} from "./types"

export function listSalesAccounts(accessToken: string): Promise<SalesAccountSummary[]> {
  return apiFetch<SalesAccountSummary[]>("/api/sales/accounts", { accessToken })
}

export function getSalesAccount(accessToken: string, id: string): Promise<SalesAccountSummary> {
  return apiFetch<SalesAccountSummary>(`/api/sales/accounts/${id}`, { accessToken })
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
): Promise<AccountHistoryEntry[]> {
  return apiFetch<AccountHistoryEntry[]>(`/api/sales/accounts/${accountId}/history`, { accessToken })
}
