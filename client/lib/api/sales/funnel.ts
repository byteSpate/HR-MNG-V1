/**
 * The funnel's fetch layer (revision §27).
 *
 * Its own file rather than more lines in `lib/api/sales.ts`, which is already
 * 681 lines and carries every phase. The same reasoning as the server side
 * (§27.18).
 */

import { apiFetch } from "../client"
import type {
  FunnelActionBody,
  FunnelCellEdit,
  FunnelGrid,
  FunnelMeetingDetail,
  FunnelQueryOptions,
  FunnelTeam,
  SalesTaskSummary,
} from "../types"

/**
 * Only the filters actually set reach the query string.
 *
 * Sending `status=undefined` would arrive as the literal string and be
 * refused, and sending every key with a blank value makes two identical
 * requests look different to the query cache.
 */
function toQuery(options: FunnelQueryOptions): string {
  const params = new URLSearchParams()
  if (options.employeeId) params.set("employeeId", options.employeeId)
  if (options.status) params.set("status", options.status)
  if (options.salesAccountId) params.set("salesAccountId", options.salesAccountId)
  if (options.hideClosed) params.set("hideClosed", "true")
  if (options.changedLastWeek) params.set("changedLastWeek", "true")
  if (options.sort) params.set("sort", options.sort)
  if (options.direction) params.set("direction", options.direction)
  const query = params.toString()
  return query ? `?${query}` : ""
}

export function getFunnel(options: FunnelQueryOptions, accessToken: string): Promise<FunnelGrid> {
  return apiFetch<FunnelGrid>(`/api/sales/funnel${toQuery(options)}`, { accessToken })
}

export function getFunnelTeam(accessToken: string): Promise<FunnelTeam> {
  return apiFetch<FunnelTeam>("/api/sales/funnel/team", { accessToken })
}

export function editFunnelCell(
  body: { opportunityId: string; edit: FunnelCellEdit; funnelMeetingId?: string | null },
  accessToken: string
): Promise<{ opportunityId: string; field: string; value: string | null }> {
  return apiFetch("/api/sales/funnel/cell", {
    method: "PATCH",
    body: JSON.stringify(body),
    accessToken,
  })
}

// ── the meeting ──

export function getFunnelMeeting(
  weekStart: string | undefined,
  accessToken: string
): Promise<FunnelMeetingDetail | null> {
  const query = weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : ""
  return apiFetch<FunnelMeetingDetail | null>(`/api/sales/funnel/meeting${query}`, { accessToken })
}

export function openFunnelMeeting(
  body: { weekStart?: string; heldOn?: string },
  accessToken: string
): Promise<FunnelMeetingDetail> {
  return apiFetch<FunnelMeetingDetail>("/api/sales/funnel/meeting", {
    method: "POST",
    body: JSON.stringify(body),
    accessToken,
  })
}

export function setMeetingAttendees(
  id: string,
  employeeIds: string[],
  accessToken: string
): Promise<FunnelMeetingDetail> {
  return apiFetch<FunnelMeetingDetail>(`/api/sales/funnel/meeting/${id}/attendees`, {
    method: "PUT",
    body: JSON.stringify({ employeeIds }),
    accessToken,
  })
}

export function setPersonReviewed(
  id: string,
  body: { employeeId: string; reviewed: boolean },
  accessToken: string
): Promise<FunnelMeetingDetail> {
  return apiFetch<FunnelMeetingDetail>(`/api/sales/funnel/meeting/${id}/reviewed`, {
    method: "PUT",
    body: JSON.stringify(body),
    accessToken,
  })
}

export function setMeetingNote(
  id: string,
  note: string | null,
  accessToken: string
): Promise<FunnelMeetingDetail> {
  return apiFetch<FunnelMeetingDetail>(`/api/sales/funnel/meeting/${id}/note`, {
    method: "PUT",
    body: JSON.stringify({ note }),
    accessToken,
  })
}

export function completeFunnelMeeting(
  id: string,
  accessToken: string
): Promise<FunnelMeetingDetail> {
  return apiFetch<FunnelMeetingDetail>(`/api/sales/funnel/meeting/${id}/complete`, {
    method: "POST",
    accessToken,
  })
}

export function reopenFunnelMeeting(id: string, accessToken: string): Promise<FunnelMeetingDetail> {
  return apiFetch<FunnelMeetingDetail>(`/api/sales/funnel/meeting/${id}/reopen`, {
    method: "POST",
    accessToken,
  })
}

/** A management note on a deal, written during the review (§27.8). */
export function addManagementNote(
  id: string,
  body: { opportunityId: string; body: string },
  accessToken: string
): Promise<{ id: string; createdAt: string }> {
  return apiFetch(`/api/sales/funnel/meeting/${id}/notes`, {
    method: "POST",
    body: JSON.stringify(body),
    accessToken,
  })
}

// ── action items (§27.13) ──

export function listMeetingActions(
  id: string,
  accessToken: string
): Promise<{ items: SalesTaskSummary[] }> {
  return apiFetch(`/api/sales/funnel/meeting/${id}/actions`, { accessToken })
}

export function createFunnelAction(
  id: string,
  body: FunnelActionBody,
  accessToken: string
): Promise<SalesTaskSummary> {
  return apiFetch(`/api/sales/funnel/meeting/${id}/actions`, {
    method: "POST",
    body: JSON.stringify(body),
    accessToken,
  })
}
