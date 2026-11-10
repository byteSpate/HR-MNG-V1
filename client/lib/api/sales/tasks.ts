import { apiFetch, apiFetchBlob } from "../client"
import type {
  ChangeTaskStatusBody,
  CreateTaskBody,
  ListTasksQuery,
  LogDoneBody,
  SalesTaskStatusResult,
  SalesTaskSummary,
  UpdateTaskBody,
} from "../types"
import { searchOf } from "./shared"

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

/** "I did this": a task made already done, dated to the day the person picked. */
export function logDoneTask(accessToken: string, body: LogDoneBody): Promise<SalesTaskSummary> {
  return apiFetch<SalesTaskSummary>("/api/sales/tasks/done", {
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

/**
 * The work log, always the caller's own (owner, 2026-11-10). `from` and `to`
 * are YYYY-MM-DD, one day or up to one week. A long log is split into several
 * pictures; ask how many first, then for each one, counting from 1.
 */
export function getDayLogCount(accessToken: string, range: { from: string; to: string }): Promise<{ pictures: number }> {
  return apiFetch(`/api/sales/day-log?${new URLSearchParams(range)}`, { accessToken })
}

export async function getDayLogImage(accessToken: string, range: { from: string; to: string }, picture: number): Promise<Blob> {
  const params = new URLSearchParams({ ...range, picture: String(picture) })
  return (await apiFetchBlob(`/api/sales/day-log/image?${params}`, { accessToken })).blob
}
