import { apiFetch, apiFetchBlob } from "../client"
import type {
  WeeklyReportDetail,
  WeeklyTeamRow,
  SaveWeeklyNoteBody,
  AddWeeklyOtherWorkBody,
} from "../types"
import { searchOf, fileNameFrom } from "./shared"

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

/** The week as it would print, kept nowhere: a look before submitting. */
export async function previewMyWeek(accessToken: string, week?: string | null): Promise<Blob> {
  const { blob } = await apiFetchBlob(`/api/sales/weekly/preview${searchOf({ week: week ?? undefined })}`, {
    accessToken,
  })
  return blob
}

/** Keeps the copy, marks the week submitted, and returns that same file. */
export async function submitMyWeek(
  accessToken: string,
  week?: string | null
): Promise<{ blob: Blob; fileName: string }> {
  const { blob, headers } = await apiFetchBlob(`/api/sales/weekly/submit${searchOf({ week: week ?? undefined })}`, {
    method: "POST",
    accessToken,
  })
  return { blob, fileName: fileNameFrom(headers, "Weekly Report.pdf") }
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
