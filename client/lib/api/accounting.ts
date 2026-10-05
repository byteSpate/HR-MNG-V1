import { sides } from "@/lib/accounting/side-style"

import { apiFetch } from "./client"
import type {
  Account,
  AccountNode,
  AccountingPeriod,
  CreateAccountInput,
  CreateJournalInput,
  FinancialYear,
  Journal,
  JournalAttachment,
  JournalLineInput,
  JournalPage,
  JournalQuery,
  LedgerResult,
  SignedDocumentUrl,
  TrialBalanceResult,
  UpdateAccountInput,
  UpdateJournalInput,
} from "./types"

/** Drops undefined and empty-string values so they never reach the query. */
function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue
    search.set(key, String(value))
  }
  const s = search.toString()
  return s ? `?${s}` : ""
}

// ── chart of accounts ──

export function listAccountTree(accessToken: string, q?: string): Promise<AccountNode[]> {
  return apiFetch<AccountNode[]>(`/api/accounting/accounts${qs({ q })}`, { accessToken })
}

/** Flat and code-sorted — what the account picker autocompletes over. */
export function listAccountsFlat(accessToken: string): Promise<Account[]> {
  return apiFetch<Account[]>("/api/accounting/accounts?flat=true", { accessToken })
}

export function createAccount(accessToken: string, input: CreateAccountInput): Promise<Account> {
  return apiFetch<Account>("/api/accounting/accounts", {
    method: "POST",
    accessToken,
    body: JSON.stringify(input),
  })
}

export function updateAccount(
  accessToken: string,
  id: string,
  input: UpdateAccountInput
): Promise<Account> {
  return apiFetch<Account>(`/api/accounting/accounts/${id}`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(input),
  })
}

export function deleteAccount(accessToken: string, id: string): Promise<void> {
  return apiFetch<void>(`/api/accounting/accounts/${id}`, { method: "DELETE", accessToken })
}

// ── financial years and periods ──

export function listFinancialYears(accessToken: string): Promise<FinancialYear[]> {
  return apiFetch<FinancialYear[]>("/api/accounting/financial-years", { accessToken })
}

export function createFinancialYear(accessToken: string, startDate: string): Promise<FinancialYear> {
  return apiFetch<FinancialYear>("/api/accounting/financial-years", {
    method: "POST",
    accessToken,
    body: JSON.stringify({ startDate }),
  })
}

/**
 * The name is free text; `startDate` only moves while the year holds no
 * journals, since changing it rebuilds all twelve periods.
 */
export function updateFinancialYear(
  accessToken: string,
  id: string,
  input: { name?: string; startDate?: string }
): Promise<FinancialYear> {
  return apiFetch<FinancialYear>(`/api/accounting/financial-years/${id}`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(input),
  })
}

export function deleteFinancialYear(accessToken: string, id: string): Promise<void> {
  return apiFetch<void>(`/api/accounting/financial-years/${id}`, { method: "DELETE", accessToken })
}

/** Drafts the CLOSING journal and returns it. Approving it locks the year. */
export function draftYearEnd(accessToken: string, id: string): Promise<Journal> {
  return apiFetch<Journal>(`/api/accounting/financial-years/${id}/year-end`, {
    method: "POST",
    accessToken,
  }).then(sides.journal)
}

export function closePeriod(accessToken: string, id: string): Promise<AccountingPeriod> {
  return apiFetch<AccountingPeriod>(`/api/accounting/periods/${id}/close`, {
    method: "POST",
    accessToken,
  })
}

export function reopenPeriod(
  accessToken: string,
  id: string,
  reason: string
): Promise<AccountingPeriod> {
  return apiFetch<AccountingPeriod>(`/api/accounting/periods/${id}/reopen`, {
    method: "POST",
    accessToken,
    body: JSON.stringify({ reason }),
  })
}

// ── journals ──
//
// Journals cross the API edge through `sides` (see lib/accounting/side-style.ts):
// what comes back is read in the bank's wording, and what is sent is saved on
// the stored side.

function toServer<T extends { lines?: JournalLineInput[] }>(input: T): T {
  return input.lines ? { ...input, lines: input.lines.map((line) => sides.lineInput(line)) } : input
}

export function listJournals(accessToken: string, query: JournalQuery): Promise<JournalPage> {
  return apiFetch<JournalPage>(`/api/accounting/journals${qs(query as never)}`, { accessToken }).then(sides.journalPage)
}

export function getJournal(accessToken: string, id: string): Promise<Journal> {
  return apiFetch<Journal>(`/api/accounting/journals/${id}`, { accessToken }).then(sides.journal)
}

export function createJournal(accessToken: string, input: CreateJournalInput): Promise<Journal> {
  return apiFetch<Journal>("/api/accounting/journals", {
    method: "POST",
    accessToken,
    body: JSON.stringify(toServer(input)),
  }).then(sides.journal)
}

export function updateJournal(
  accessToken: string,
  id: string,
  input: UpdateJournalInput
): Promise<Journal> {
  return apiFetch<Journal>(`/api/accounting/journals/${id}`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(toServer(input)),
  }).then(sides.journal)
}

export function deleteJournal(accessToken: string, id: string): Promise<void> {
  return apiFetch<void>(`/api/accounting/journals/${id}`, { method: "DELETE", accessToken })
}

export function submitJournal(accessToken: string, id: string): Promise<Journal> {
  return apiFetch<Journal>(`/api/accounting/journals/${id}/submit`, { method: "POST", accessToken }).then(sides.journal)
}

export function approveJournal(accessToken: string, id: string): Promise<Journal> {
  return apiFetch<Journal>(`/api/accounting/journals/${id}/approve`, { method: "POST", accessToken }).then(sides.journal)
}

export function rejectJournal(accessToken: string, id: string, note: string): Promise<Journal> {
  return apiFetch<Journal>(`/api/accounting/journals/${id}/reject`, {
    method: "POST",
    accessToken,
    body: JSON.stringify({ note }),
  }).then(sides.journal)
}

/** Returns the new REVERSAL draft, which then follows the ordinary path. */
export function reverseJournal(accessToken: string, id: string, reason: string): Promise<Journal> {
  return apiFetch<Journal>(`/api/accounting/journals/${id}/reverse`, {
    method: "POST",
    accessToken,
    body: JSON.stringify({ reason }),
  }).then(sides.journal)
}

// ── attachments ──

export function listJournalAttachments(
  accessToken: string,
  journalId: string
): Promise<JournalAttachment[]> {
  return apiFetch<JournalAttachment[]>(`/api/accounting/journals/${journalId}/attachments`, {
    accessToken,
  })
}

export function uploadJournalAttachment(
  accessToken: string,
  journalId: string,
  file: File
): Promise<JournalAttachment> {
  const body = new FormData()
  body.append("file", file)
  // No Content-Type header: the browser sets it, with the multipart boundary.
  return apiFetch<JournalAttachment>(`/api/accounting/journals/${journalId}/attachments`, {
    method: "POST",
    accessToken,
    body,
  })
}

export function getAttachmentUrl(
  accessToken: string,
  attachmentId: string
): Promise<SignedDocumentUrl> {
  return apiFetch<SignedDocumentUrl>(`/api/accounting/attachments/${attachmentId}/url`, {
    accessToken,
  })
}

export function deleteAttachment(accessToken: string, attachmentId: string): Promise<void> {
  return apiFetch<void>(`/api/accounting/attachments/${attachmentId}`, {
    method: "DELETE",
    accessToken,
  })
}

// ── read models ──

export interface LedgerParams {
  accountId: string
  from: string
  to: string
  departmentId?: string
  employeeId?: string
}

export function getLedger(accessToken: string, params: LedgerParams): Promise<LedgerResult> {
  return apiFetch<LedgerResult>(`/api/accounting/ledger${qs(params as never)}`, { accessToken }).then(sides.ledger)
}

export function getCashBook(accessToken: string, params: LedgerParams): Promise<LedgerResult> {
  return apiFetch<LedgerResult>(`/api/accounting/cash-book${qs(params as never)}`, { accessToken }).then(sides.ledger)
}

export function getBankBook(accessToken: string, params: LedgerParams): Promise<LedgerResult> {
  return apiFetch<LedgerResult>(`/api/accounting/bank-book${qs(params as never)}`, { accessToken }).then(sides.ledger)
}

export function listCashAccounts(accessToken: string, kind: "CASH" | "BANK"): Promise<Account[]> {
  return apiFetch<Account[]>(`/api/accounting/cash-accounts${qs({ kind })}`, { accessToken })
}

export function getTrialBalance(
  accessToken: string,
  from: string,
  to: string
): Promise<TrialBalanceResult> {
  return apiFetch<TrialBalanceResult>(`/api/accounting/trial-balance${qs({ from, to })}`, {
    accessToken,
  })
}
