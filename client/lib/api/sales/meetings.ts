import { apiFetch } from "../client"
import type {
  SalesEligibleEmployee,
  ChangeMeetingStatusBody,
  CreateMeetingBody,
  ListMeetingsQuery,
  SalesMeetingSummary,
  UpdateMeetingBody,
} from "../types"
import { searchOf } from "./shared"

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
