import { apiFetch } from "./client"
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
  CreateOpportunityBody,
  CreateSalesCommentBody,
  OpportunityLineBody,
  OpportunityLineSummary,
  OpportunityHistory,
  OpportunityPage,
  OpportunityStage,
  OpportunityStatus,
  OpportunitySummary,
  SalesCommentPage,
  SalesCommentSummary,
  SalesDashboardPayload,
  SalesAccountMargin,
  SalesTargetYear,
  SetSalesTargetBody,
  UpdateOpportunityBody,
  UpdateOpportunityLineBody,
  UpdateSalesAccountBody,
  TimelineItem,
  ChangeMeetingStatusBody,
  ChangeTaskStatusBody,
  CreateMeetingBody,
  CreateTaskBody,
  ListMeetingsQuery,
  ListTasksQuery,
  SalesMeetingSummary,
  SalesTaskStatusResult,
  SalesTaskSummary,
  UpdateMeetingBody,
  UpdateTaskBody,
} from "./types"

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

export function listSalesComments(
  accessToken: string,
  entity: "SALES_ACCOUNT" | "OPPORTUNITY",
  entityId: string
): Promise<SalesCommentPage> {
  const search = new URLSearchParams({ entity, entityId })
  return apiFetch<SalesCommentPage>(`/api/sales/comments?${search.toString()}`, { accessToken })
}

export function createSalesComment(
  accessToken: string,
  body: CreateSalesCommentBody
): Promise<SalesCommentSummary> {
  return apiFetch<SalesCommentSummary>("/api/sales/comments", {
    method: "POST",
    accessToken,
    body: JSON.stringify(body),
  })
}

export function updateSalesComment(
  accessToken: string,
  id: string,
  body: string
): Promise<SalesCommentSummary> {
  return apiFetch<SalesCommentSummary>(`/api/sales/comments/${id}`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify({ body }),
  })
}

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

/** `employeeId` is a uuid, or the literal "all" for the team roll-up. */
export function getSalesDashboard(
  accessToken: string,
  employeeId?: string
): Promise<SalesDashboardPayload> {
  const search = new URLSearchParams()
  if (employeeId) search.set("employeeId", employeeId)
  const qs = search.toString()
  return apiFetch<SalesDashboardPayload>(`/api/sales/dashboard${qs ? `?${qs}` : ""}`, {
    accessToken,
  })
}

/** Only the filters that are set, so an absent one never reaches the server as "undefined". */
function searchOf(query: object): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "" || value === false) continue
    search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ""
}

// ── meetings ──────────────────────────────────────────────────────────────

export function listMeetings(
  accessToken: string,
  query: ListMeetingsQuery = {}
): Promise<{ items: SalesMeetingSummary[] }> {
  return apiFetch<{ items: SalesMeetingSummary[] }>(`/api/sales/meetings${searchOf(query)}`, { accessToken })
}

export function createMeeting(accessToken: string, body: CreateMeetingBody): Promise<SalesMeetingSummary> {
  return apiFetch<SalesMeetingSummary>("/api/sales/meetings", {
    method: "POST",
    accessToken,
    body: JSON.stringify(body),
  })
}

export function updateMeeting(accessToken: string, id: string, body: UpdateMeetingBody): Promise<SalesMeetingSummary> {
  return apiFetch<SalesMeetingSummary>(`/api/sales/meetings/${id}`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(body),
  })
}

export function changeMeetingStatus(
  accessToken: string,
  id: string,
  body: ChangeMeetingStatusBody
): Promise<SalesMeetingSummary> {
  return apiFetch<SalesMeetingSummary>(`/api/sales/meetings/${id}/status`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(body),
  })
}

// ── tasks ─────────────────────────────────────────────────────────────────

export function listTasks(accessToken: string, query: ListTasksQuery = {}): Promise<{ items: SalesTaskSummary[] }> {
  return apiFetch<{ items: SalesTaskSummary[] }>(`/api/sales/tasks${searchOf(query)}`, { accessToken })
}

export function createTask(accessToken: string, body: CreateTaskBody): Promise<SalesTaskSummary> {
  return apiFetch<SalesTaskSummary>("/api/sales/tasks", {
    method: "POST",
    accessToken,
    body: JSON.stringify(body),
  })
}

export function updateTask(accessToken: string, id: string, body: UpdateTaskBody): Promise<SalesTaskSummary> {
  return apiFetch<SalesTaskSummary>(`/api/sales/tasks/${id}`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(body),
  })
}

/** Done comes back with `nextFollowUpOn`, the date to offer for the next follow-up. */
export function changeTaskStatus(
  accessToken: string,
  id: string,
  body: ChangeTaskStatusBody
): Promise<SalesTaskStatusResult> {
  return apiFetch<SalesTaskStatusResult>(`/api/sales/tasks/${id}/status`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(body),
  })
}
