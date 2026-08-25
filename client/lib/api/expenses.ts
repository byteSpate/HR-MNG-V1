import { apiFetch, apiFetchBlob } from "./client"
import type {
  ExpenseCategory,
  ExpenseClaim,
  ExpenseClaimInput,
  ExpenseReceipt,
  ExpenseReport,
  ExpenseStatus,
} from "./types"

export function listExpenseCategories(accessToken: string): Promise<ExpenseCategory[]> {
  return apiFetch<ExpenseCategory[]>("/api/expenses/categories", { accessToken })
}

export function createExpenseClaim(
  accessToken: string,
  input: ExpenseClaimInput
): Promise<ExpenseClaim> {
  return apiFetch<ExpenseClaim>("/api/expenses", {
    method: "POST",
    accessToken,
    body: JSON.stringify(input),
  })
}

export function getMyExpenseClaims(accessToken: string): Promise<ExpenseClaim[]> {
  return apiFetch<ExpenseClaim[]>("/api/expenses/me", { accessToken })
}

export function listExpenseClaims(
  accessToken: string,
  query: { status?: ExpenseStatus; employeeId?: string } = {}
): Promise<ExpenseClaim[]> {
  const params = new URLSearchParams()
  if (query.status) params.set("status", query.status)
  if (query.employeeId) params.set("employeeId", query.employeeId)
  const qs = params.toString()
  return apiFetch<ExpenseClaim[]>(`/api/expenses${qs ? `?${qs}` : ""}`, { accessToken })
}

export function approveExpenseClaim(
  accessToken: string,
  id: string,
  note?: string
): Promise<ExpenseClaim> {
  return apiFetch<ExpenseClaim>(`/api/expenses/${id}/approve`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify({ note }),
  })
}

export function rejectExpenseClaim(
  accessToken: string,
  id: string,
  note: string
): Promise<ExpenseClaim> {
  return apiFetch<ExpenseClaim>(`/api/expenses/${id}/reject`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify({ note }),
  })
}

// ── Receipts ──────────────────────────────────

/**
 * Uploaded after the claim exists, never before: the file is stored under the
 * claim's own folder and the server checks ownership against it, so there is
 * nothing to attach to until the claim has an id.
 */
export function uploadClaimReceipt(
  accessToken: string,
  claimId: string,
  file: File
): Promise<ExpenseReceipt> {
  const body = new FormData()
  body.append("file", file)
  // No Content-Type header: apiFetch detects FormData and lets the browser
  // set the multipart boundary itself.
  return apiFetch<ExpenseReceipt>(`/api/expenses/${claimId}/receipts`, {
    method: "POST",
    accessToken,
    body,
  })
}

export function listClaimReceipts(
  accessToken: string,
  claimId: string
): Promise<ExpenseReceipt[]> {
  return apiFetch<ExpenseReceipt[]>(`/api/expenses/${claimId}/receipts`, { accessToken })
}

/** Signed and short-lived — fetch it when the user clicks, never store it. */
export function getClaimReceiptUrl(
  accessToken: string,
  receiptId: string
): Promise<{ url: string; expiresAt: string }> {
  return apiFetch<{ url: string; expiresAt: string }>(
    `/api/expenses/receipts/${receiptId}/url`,
    { accessToken }
  )
}

export function deleteClaimReceipt(accessToken: string, receiptId: string): Promise<void> {
  return apiFetch<void>(`/api/expenses/receipts/${receiptId}`, {
    method: "DELETE",
    accessToken,
  })
}

// ── Reports ───────────────────────────────────

export interface ExpenseReportQuery {
  from: string
  to: string
  employeeId?: string
  status?: ExpenseStatus
}

function reportParams(query: ExpenseReportQuery, format?: "csv" | "pdf"): string {
  const params = new URLSearchParams({ from: query.from, to: query.to })
  if (query.employeeId) params.set("employeeId", query.employeeId)
  if (query.status) params.set("status", query.status)
  if (format) params.set("format", format)
  return params.toString()
}

export function getExpenseReport(
  accessToken: string,
  query: ExpenseReportQuery
): Promise<ExpenseReport> {
  return apiFetch<ExpenseReport>(`/api/expenses/report?${reportParams(query)}`, { accessToken })
}

/**
 * The same report as a file. The server builds both, so a downloaded document
 * cannot carry a figure the screen does not show.
 */
export async function downloadExpenseReport(
  accessToken: string,
  query: ExpenseReportQuery,
  format: "csv" | "pdf" = "pdf"
): Promise<Blob> {
  const { blob } = await apiFetchBlob(`/api/expenses/report?${reportParams(query, format)}`, {
    accessToken,
  })
  return blob
}
