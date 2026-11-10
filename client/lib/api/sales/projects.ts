import { apiFetch } from "../client"
import type { ProjectDailyLogView, ProjectListRow, ProjectStatus, ProjectSummary, SalesTaskSummary, SalesTrack } from "../types"

export interface ListProjectsQuery {
  /** The search box (owner, 2026-11-10). Searched on the server. */
  q?: string
  status?: ProjectStatus
  managerEmployeeId?: string
  salesAccountId?: string
  /** The Opportunity's track, so a list can show one track or both. */
  track?: SalesTrack
}

export function listProjects(accessToken: string, query: ListProjectsQuery = {}): Promise<ProjectListRow[]> {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v) search.set(k, String(v))
  const qs = search.toString()
  return apiFetch<ProjectListRow[]>(`/api/sales/projects${qs ? `?${qs}` : ""}`, { accessToken })
}

export function getProject(accessToken: string, id: string): Promise<ProjectSummary> {
  return apiFetch<ProjectSummary>(`/api/sales/projects/${id}`, { accessToken })
}

export function startProject(accessToken: string, opportunityId: string): Promise<ProjectSummary> {
  return apiFetch<ProjectSummary>(`/api/sales/opportunities/${opportunityId}/project`, { method: "POST", accessToken })
}

export interface UpdateProjectBody {
  name?: string
  managerEmployeeId?: string
  startOn?: string | null
  dueOn?: string | null
  priority?: "LOW" | "NORMAL" | "HIGH"
  budget?: string | null
}

const send = (accessToken: string, path: string, method: string, body?: unknown) =>
  apiFetch<ProjectSummary>(path, { method, accessToken, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

export const updateProject = (t: string, id: string, body: UpdateProjectBody) => send(t, `/api/sales/projects/${id}`, "PATCH", body)
export const setProjectTeam = (t: string, id: string, members: Array<{ employeeId: string; responsibility: string | null }>) =>
  send(t, `/api/sales/projects/${id}/team`, "PUT", { members })
export const changeProjectStatus = (t: string, id: string, body: { status: ProjectStatus; reason?: string }) =>
  send(t, `/api/sales/projects/${id}/status`, "PATCH", body)
export const addMilestone = (t: string, id: string, body: { title: string; dueOn?: string | null }) =>
  send(t, `/api/sales/projects/${id}/milestones`, "POST", body)
export const updateMilestone = (t: string, milestoneId: string, body: { title?: string; dueOn?: string | null; done?: boolean }) =>
  send(t, `/api/sales/project-milestones/${milestoneId}`, "PATCH", body)
export const removeMilestone = (t: string, milestoneId: string) => send(t, `/api/sales/project-milestones/${milestoneId}`, "DELETE")
export const tickProjectLine = (t: string, id: string, lineId: string) => send(t, `/api/sales/projects/${id}/lines/${lineId}/done`, "PUT")
export const untickProjectLine = (t: string, id: string, lineId: string) => send(t, `/api/sales/projects/${id}/lines/${lineId}/done`, "DELETE")

// ── Project Tasks (spec §2.1) ───────────────────────────────────────────────
export const listProjectTasks = (t: string, id: string) =>
  apiFetch<SalesTaskSummary[]>(`/api/sales/projects/${id}/tasks`, { accessToken: t })

export const addProjectTask = (t: string, id: string, body: { title: string; dueOn: string; assigneeEmployeeId?: string }) =>
  apiFetch<SalesTaskSummary>(`/api/sales/projects/${id}/tasks`, { method: "POST", accessToken: t, body: JSON.stringify(body) })

export const cancelProjectTask = (t: string, taskId: string, reason: string) =>
  apiFetch<SalesTaskSummary>(`/api/sales/project-tasks/${taskId}/cancel`, { method: "POST", accessToken: t, body: JSON.stringify({ reason }) })

// ── How it is going (spec §2.3) ─────────────────────────────────────────────
export const listProjectActivity = (t: string, id: string) =>
  apiFetch<Array<{ id: string; at: string; byName: string | null; text: string }>>(`/api/sales/projects/${id}/activity`, { accessToken: t })

export const getProjectDailyLog = (t: string, id: string, week?: string) =>
  apiFetch<ProjectDailyLogView>(`/api/sales/projects/${id}/daily-log${week ? `?week=${week}` : ""}`, { accessToken: t })

/**
 * One Daily Log line: what I did on this Project that day, or that I did no
 * work on it. The URL keeps its old `/weekly/project-log` name (owner,
 * 2026-11-02): the Weekly Report is gone, the path was not renamed.
 */
export function saveProjectLog(
  accessToken: string,
  body: { date: string; projectId: string; noWork: boolean; text: string | null }
): Promise<void> {
  return apiFetch<void>("/api/sales/weekly/project-log", { method: "PUT", accessToken, body: JSON.stringify(body) })
}

/** A person takes back a line they wrote. Only their own. */
export function removeProjectLog(accessToken: string, id: string): Promise<void> {
  return apiFetch<void>(`/api/sales/weekly/project-log/${id}`, { method: "DELETE", accessToken })
}
