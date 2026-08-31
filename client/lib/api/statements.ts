import { apiFetch, apiFetchBlob } from "./client"
import type { AnnexureResult, CashFlowResult, EquityResult, NotesResult, PnlResult, PolicyNote, PositionResult } from "./types"

export interface StatementRange {
  from: string
  to: string
}

function qs({ from, to }: StatementRange): string {
  return `?${new URLSearchParams({ from, to }).toString()}`
}

export function getProfitOrLoss(
  accessToken: string,
  range: StatementRange
): Promise<PnlResult> {
  return apiFetch<PnlResult>(`/api/statements/profit-or-loss${qs(range)}`, { accessToken })
}

export function getFinancialPosition(
  accessToken: string,
  range: StatementRange
): Promise<PositionResult> {
  return apiFetch<PositionResult>(`/api/statements/financial-position${qs(range)}`, {
    accessToken,
  })
}

export function getChangesInEquity(
  accessToken: string,
  range: StatementRange
): Promise<EquityResult> {
  return apiFetch<EquityResult>(`/api/statements/changes-in-equity${qs(range)}`, { accessToken })
}

export function getCashFlow(accessToken: string, range: StatementRange): Promise<CashFlowResult> { return apiFetch<CashFlowResult>(`/api/statements/cash-flow${qs(range)}`, { accessToken }) }
export function getNotes(accessToken: string, range: StatementRange): Promise<NotesResult> { return apiFetch<NotesResult>(`/api/statements/notes${qs(range)}`, { accessToken }) }
export function getAnnexureA(accessToken: string, range: StatementRange): Promise<AnnexureResult> { return apiFetch<AnnexureResult>(`/api/statements/annexure-a${qs(range)}`, { accessToken }) }
export interface PolicyNoteInput {
  ref: string
  title: string
  body: string
  sortOrder?: number
}

export function listPolicyNotes(accessToken: string): Promise<PolicyNote[]> { return apiFetch<PolicyNote[]>("/api/statements/policy-notes", { accessToken }) }
export function createPolicyNote(accessToken: string, input: PolicyNoteInput): Promise<PolicyNote> { return apiFetch<PolicyNote>("/api/statements/policy-notes", { method: "POST", accessToken, body: JSON.stringify(input) }) }
export function updatePolicyNote(accessToken: string, id: string, input: Partial<PolicyNoteInput>): Promise<PolicyNote> { return apiFetch<PolicyNote>(`/api/statements/policy-notes/${id}`, { method: "PATCH", accessToken, body: JSON.stringify(input) }) }
export function deletePolicyNote(accessToken: string, id: string): Promise<void> { return apiFetch<void>(`/api/statements/policy-notes/${id}`, { method: "DELETE", accessToken }) }
export async function downloadStatementsPdf(
  accessToken: string,
  range: StatementRange
): Promise<Blob> {
  const { blob } = await apiFetchBlob(`/api/statements/pdf${qs(range)}`, { accessToken })
  return blob
}
