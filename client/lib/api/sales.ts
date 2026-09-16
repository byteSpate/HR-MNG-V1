import { apiFetch, apiFetchBlob } from "./client"
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
  MinutesTemplate,
  MinutesTemplateSection,
  SaveMinutesBody,
  SalesMinutesDetail,
  SalesMinutesListItem,
  SalesMinutesStatus,
  WeeklyReportDetail,
  WeeklyTeamRow,
  SaveWeeklyNoteBody,
  AddWeeklyOtherWorkBody,
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

/** Everyone who may attend on our side: anyone with Sales Hub access, not only the account's team. */
export function listMeetingAttendeeOptions(accessToken: string): Promise<SalesEligibleEmployee[]> {
  return apiFetch<SalesEligibleEmployee[]>("/api/sales/meetings/attendee-options", { accessToken })
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

// ── meeting minutes (phase 4) ─────────────────────────────────────────────

/** Starts the minutes of a completed meeting, or opens the ones already started. */
export function startMinutes(accessToken: string, meetingId: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/api/sales/meetings/${meetingId}/minutes`, { method: "POST", accessToken })
}

export function getMinutes(accessToken: string, id: string): Promise<SalesMinutesDetail> {
  return apiFetch<SalesMinutesDetail>(`/api/sales/minutes/${id}`, { accessToken })
}

/** The whole document, as the editor holds it. The last save wins. */
export function saveMinutes(accessToken: string, id: string, body: SaveMinutesBody): Promise<SalesMinutesDetail> {
  return apiFetch<SalesMinutesDetail>(`/api/sales/minutes/${id}`, {
    method: "PUT",
    accessToken,
    body: JSON.stringify(body),
  })
}

/** The requirement question, asked only for a meeting with no deal. Saved at once. */
export function answerMinutesRequirement(accessToken: string, id: string, found: boolean): Promise<SalesMinutesDetail> {
  return apiFetch<SalesMinutesDetail>(`/api/sales/minutes/${id}/requirement`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify({ found }),
  })
}

/** Only before the first send; the server refuses after. */
export function deleteMinutes(accessToken: string, id: string): Promise<void> {
  return apiFetch<void>(`/api/sales/minutes/${id}`, { method: "DELETE", accessToken })
}

export function listMinutes(
  accessToken: string,
  query: { mine?: boolean; status?: SalesMinutesStatus } = {}
): Promise<{ items: SalesMinutesListItem[] }> {
  return apiFetch<{ items: SalesMinutesListItem[] }>(`/api/sales/minutes${searchOf(query)}`, { accessToken })
}

/** Completed meetings from the last 7 days that nobody has started minutes for. */
export function listMeetingsWaitingForMinutes(
  accessToken: string,
  mine: boolean
): Promise<{ items: SalesMeetingSummary[] }> {
  return apiFetch<{ items: SalesMeetingSummary[] }>(`/api/sales/minutes/waiting${mine ? "?mine=true" : ""}`, {
    accessToken,
  })
}

/** A PDF marked DRAFT across every page. Nothing is kept. */
export async function previewMinutes(accessToken: string, id: string): Promise<Blob> {
  return (await apiFetchBlob(`/api/sales/minutes/${id}/preview`, { accessToken })).blob
}

/** Keeps the final copy, marks the minutes sent, and returns that same file to download. */
export async function sendMinutes(accessToken: string, id: string, sentTo: string | null): Promise<Blob> {
  const { blob } = await apiFetchBlob(`/api/sales/minutes/${id}/send`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sentTo }),
  })
  return blob
}

/** A copy exactly as it was sent. */
export async function getSentMinutesCopy(accessToken: string, sendId: string): Promise<Blob> {
  return (await apiFetchBlob(`/api/sales/minutes/sends/${sendId}/file`, { accessToken })).blob
}

// ── Sales Settings ────────────────────────────────────────────────────────

/** The minutes template. Sales Admins only. */
export function getMinutesTemplate(accessToken: string): Promise<MinutesTemplate> {
  return apiFetch<MinutesTemplate>("/api/sales/settings/minutes-template", { accessToken })
}

export function saveMinutesTemplate(accessToken: string, sections: MinutesTemplateSection[]): Promise<MinutesTemplate> {
  return apiFetch<MinutesTemplate>("/api/sales/settings/minutes-template", {
    method: "PUT",
    accessToken,
    body: JSON.stringify({ sections }),
  })
}

// ── the weekly report (phase 5, revision §26) ────────────────────────────────

/** My week: the composed days, where it stands, and the copies kept so far. */
export function getMyWeek(accessToken: string, week?: string | null): Promise<WeeklyReportDetail> {
  return apiFetch<WeeklyReportDetail>(`/api/sales/weekly${searchOf({ week: week ?? undefined })}`, {
    accessToken,
  })
}

/** One account's typed lines for one day. Answers with the whole week again. */
export function saveWeeklyNote(accessToken: string, body: SaveWeeklyNoteBody): Promise<WeeklyReportDetail> {
  return apiFetch<WeeklyReportDetail>("/api/sales/weekly/notes", {
    method: "PUT",
    accessToken,
    body: JSON.stringify(body),
  })
}

/** Work with no account behind it (§26.11). */
export function addWeeklyOtherWork(
  accessToken: string,
  body: AddWeeklyOtherWorkBody
): Promise<WeeklyReportDetail> {
  return apiFetch<WeeklyReportDetail>("/api/sales/weekly/other-work", {
    method: "POST",
    accessToken,
    body: JSON.stringify(body),
  })
}

export function removeWeeklyOtherWork(accessToken: string, id: string): Promise<void> {
  return apiFetch<void>(`/api/sales/weekly/other-work/${id}`, { method: "DELETE", accessToken })
}

/** Keeps the copy, marks the week submitted, and returns that same file. */
export async function submitMyWeek(accessToken: string, week?: string | null): Promise<Blob> {
  const { blob } = await apiFetchBlob(`/api/sales/weekly/submit${searchOf({ week: week ?? undefined })}`, {
    method: "POST",
    accessToken,
  })
  return blob
}

/** A kept copy, exactly as it was submitted. */
export async function getWeeklyCopy(accessToken: string, copyId: string): Promise<Blob> {
  return (await apiFetchBlob(`/api/sales/weekly/copies/${copyId}/file`, { accessToken })).blob
}

/** All Reports: every Sales User for one week (§26.15). Sales Admins only. */
export function listTeamWeek(accessToken: string, week?: string | null): Promise<WeeklyTeamRow[]> {
  return apiFetch<WeeklyTeamRow[]>(`/api/sales/weekly/all${searchOf({ week: week ?? undefined })}`, {
    accessToken,
  })
}

/** One person's week, read-only, for a Sales Admin. */
export function getEmployeeWeek(
  accessToken: string,
  employeeId: string,
  week?: string | null
): Promise<WeeklyReportDetail> {
  return apiFetch<WeeklyReportDetail>(
    `/api/sales/weekly/all/${employeeId}${searchOf({ week: week ?? undefined })}`,
    { accessToken }
  )
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
