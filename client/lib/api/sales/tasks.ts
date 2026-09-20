import { apiFetch } from "../client"
import type {
  ChangeTaskStatusBody,
  CreateTaskBody,
  ListTasksQuery,
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
