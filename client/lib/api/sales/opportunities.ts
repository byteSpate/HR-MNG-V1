import { apiFetch } from "../client"
import type {
  CreateOpportunityBody,
  OpportunityLineBody,
  OpportunityLineSummary,
  OpportunityHistory,
  OpportunityPage,
  OpportunityStage,
  OpportunityStatus,
  OpportunitySummary,
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

export function changeOpportunityStage(
  accessToken: string,
  id: string,
  stage: OpportunityStage
): Promise<OpportunitySummary> {
  return apiFetch<OpportunitySummary>(`/api/sales/opportunities/${id}/stage`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify({ stage }),
  })
}

export function changeOpportunityStatus(
  accessToken: string,
  id: string,
  body: { status: OpportunityStatus; statusReason?: string }
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
