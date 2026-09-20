import { apiFetch, apiFetchBlob } from "../client"
import type {
  SalesMeetingSummary,
  MinutesTemplate,
  MinutesTemplateSection,
  SaveMinutesBody,
  SalesMinutesDetail,
  SalesMinutesListItem,
  SalesMinutesStatus,
} from "../types"
import { searchOf } from "./shared"

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
