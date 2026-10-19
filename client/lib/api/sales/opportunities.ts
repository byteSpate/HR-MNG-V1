import { apiFetch } from "../client"
import type {
  CreateOpportunityBody,
  DocumentLinkSummary,
  OpportunityLineBody,
  OpportunityLineSummary,
  OpportunityHistory,
  OpportunityPage,
  OpportunityStage,
  OpportunityStatus,
  OpportunitySummary,
  QuoteBody,
  UpdateOpportunityBody,
  UpdateOpportunityLineBody,
  TimelineItem,
} from "../types"

export interface ListOpportunitiesQuery {
  status?: OpportunityStatus
  stage?: OpportunityStage
  salesAccountId?: string
  ownerEmployeeId?: string
  mine?: boolean
  closing?: number
  quiet?: number
  stuck?: number
  cursor?: string
  limit?: number
}

export function listOpportunities(
  accessToken: string,
  query: ListOpportunitiesQuery = {}
): Promise<OpportunityPage> {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") search.set(key, String(value))
  }
  const qs = search.toString()
  return apiFetch<OpportunityPage>(`/api/sales/opportunities${qs ? `?${qs}` : ""}`, { accessToken })
}

export function listOpportunityOwners(
  accessToken: string
): Promise<{ id: string; fullName: string }[]> {
  return apiFetch<{ id: string; fullName: string }[]>("/api/sales/opportunities/owners", { accessToken })
}

export function getOpportunity(accessToken: string, id: string): Promise<OpportunitySummary> {
  return apiFetch<OpportunitySummary>(`/api/sales/opportunities/${id}`, { accessToken })
}

export function createOpportunity(
  accessToken: string,
  body: CreateOpportunityBody
): Promise<OpportunitySummary> {
  return apiFetch<OpportunitySummary>("/api/sales/opportunities", {
    method: "POST",
    accessToken,
    body: JSON.stringify(body),
  })
}

export function updateOpportunity(
  accessToken: string,
  id: string,
  body: UpdateOpportunityBody
): Promise<OpportunitySummary> {
  return apiFetch<OpportunitySummary>(`/api/sales/opportunities/${id}`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(body),
  })
}

/**
 * Moving into a quote stage may carry the quote, or a reason to move without
 * one (owner, 2026-10-13). `quoteAskFor` in `stages.ts` says which.
 */
export function changeOpportunityStage(
  accessToken: string,
  id: string,
  stage: OpportunityStage,
  extra?: { quote?: QuoteBody; skipQuoteReason?: string }
): Promise<OpportunitySummary> {
  return apiFetch<OpportunitySummary>(`/api/sales/opportunities/${id}/stage`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify({ stage, ...extra }),
  })
}

export function changeOpportunityStatus(
  accessToken: string,
  id: string,
  // Ongoing is not here: Won, Lost and Cancelled are final (spec §1.4).
  body: { status: Exclude<OpportunityStatus, "ONGOING">; statusReason?: string }
): Promise<OpportunitySummary> {
  return apiFetch<OpportunitySummary>(`/api/sales/opportunities/${id}/status`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(body),
  })
}

export function changeOpportunityNextStep(
  accessToken: string,
  id: string,
  /** `alsoCreateTask` makes the step a task for whoever ticked the box too. */
  body: { nextStep?: string | null; nextStepDueOn?: string | null; alsoCreateTask?: boolean }
): Promise<OpportunitySummary> {
  return apiFetch<OpportunitySummary>(`/api/sales/opportunities/${id}/next-step`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(body),
  })
}

export function getOpportunityTimeline(
  accessToken: string,
  id: string
): Promise<{ items: TimelineItem[] }> {
  return apiFetch<{ items: TimelineItem[] }>(`/api/sales/opportunities/${id}/timeline`, {
    accessToken,
  })
}

export function getOpportunityHistory(
  accessToken: string,
  id: string
): Promise<OpportunityHistory> {
  return apiFetch<OpportunityHistory>(`/api/sales/opportunities/${id}/history`, { accessToken })
}

export function addOpportunityLine(
  accessToken: string,
  opportunityId: string,
  body: OpportunityLineBody
): Promise<OpportunityLineSummary> {
  return apiFetch<OpportunityLineSummary>(`/api/sales/opportunities/${opportunityId}/lines`, {
    method: "POST",
    accessToken,
    body: JSON.stringify(body),
  })
}

export function updateOpportunityLine(
  accessToken: string,
  lineId: string,
  body: UpdateOpportunityLineBody
): Promise<OpportunityLineSummary> {
  return apiFetch<OpportunityLineSummary>(`/api/sales/lines/${lineId}`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(body),
  })
}

export function deleteOpportunityLine(accessToken: string, lineId: string): Promise<void> {
  return apiFetch<void>(`/api/sales/lines/${lineId}`, { method: "DELETE", accessToken })
}

export function reorderOpportunityLines(
  accessToken: string,
  opportunityId: string,
  lineIds: string[]
): Promise<OpportunityLineSummary[]> {
  return apiFetch<OpportunityLineSummary[]>(
    `/api/sales/opportunities/${opportunityId}/lines/reorder`,
    { method: "PUT", accessToken, body: JSON.stringify({ lineIds }) }
  )
}

export function suggestOpportunityLineValues(
  accessToken: string,
  field: "product" | "brand" | "model",
  q = ""
): Promise<string[]> {
  const search = new URLSearchParams({ field })
  if (q) search.set("q", q)
  return apiFetch<string[]>(`/api/sales/suggestions/oem?${search.toString()}`, { accessToken })
}

/** The weekly report's Application column, answered on the deal (§26.9). */
export function setSoftwareNeeded(
  accessToken: string,
  id: string,
  softwareNeeded: boolean | null
): Promise<OpportunitySummary> {
  return apiFetch<OpportunitySummary>(`/api/sales/opportunities/${id}/software-needed`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify({ softwareNeeded }),
  })
}

/** Fixes a status set by mistake. Sales Admin or Super Admin only (spec §1.4). */
export function correctOpportunityStatus(
  accessToken: string,
  id: string,
  body: { status: OpportunityStatus; reason: string }
): Promise<OpportunitySummary> {
  return apiFetch<OpportunitySummary>(`/api/sales/opportunities/${id}/correct-status`, {
    method: "POST", accessToken, body: JSON.stringify(body),
  })
}

export function listDocumentLinks(accessToken: string, opportunityId: string): Promise<DocumentLinkSummary[]> {
  return apiFetch<DocumentLinkSummary[]>(`/api/sales/opportunities/${opportunityId}/documents`, { accessToken })
}

export function addDocumentLink(
  accessToken: string,
  opportunityId: string,
  body: { name: string; url: string; stage?: OpportunityStage; kind?: "GENERAL" | "COSTING_BOQ"; quoteId?: string | null }
): Promise<DocumentLinkSummary> {
  return apiFetch<DocumentLinkSummary>(`/api/sales/opportunities/${opportunityId}/documents`, {
    method: "POST", accessToken, body: JSON.stringify(body),
  })
}

export function removeDocumentLink(accessToken: string, linkId: string): Promise<void> {
  return apiFetch<void>(`/api/sales/documents/${linkId}`, { method: "DELETE", accessToken })
}

/** Who may own the Software Opportunity this one is handed to (spec §2.5). */
export function listHandOverOwners(accessToken: string, id: string): Promise<Array<{ id: string; fullName: string }>> {
  return apiFetch<Array<{ id: string; fullName: string }>>(`/api/sales/opportunities/${id}/handover-owners`, { accessToken })
}

/** Hands the software part over, once, and answers with the new Opportunity. */
export function handOverToSoftware(
  accessToken: string,
  id: string,
  body: { name?: string; ownerEmployeeId: string }
): Promise<OpportunitySummary> {
  return apiFetch<OpportunitySummary>(`/api/sales/opportunities/${id}/handover`, {
    method: "POST", accessToken, body: JSON.stringify(body),
  })
}

// ── Quotes (owner, 2026-10-13). Each returns the Opportunity, whose amount follows the latest quote.

export function addQuote(accessToken: string, opportunityId: string, body: QuoteBody): Promise<OpportunitySummary> {
  return apiFetch<OpportunitySummary>(`/api/sales/opportunities/${opportunityId}/quotes`, {
    method: "POST",
    accessToken,
    body: JSON.stringify(body),
  })
}

export function editQuote(
  accessToken: string,
  opportunityId: string,
  quoteId: string,
  body: QuoteBody
): Promise<OpportunitySummary> {
  return apiFetch<OpportunitySummary>(`/api/sales/opportunities/${opportunityId}/quotes/${quoteId}`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(body),
  })
}

export function deleteQuote(accessToken: string, opportunityId: string, quoteId: string): Promise<OpportunitySummary> {
  return apiFetch<OpportunitySummary>(`/api/sales/opportunities/${opportunityId}/quotes/${quoteId}`, {
    method: "DELETE",
    accessToken,
  })
}
