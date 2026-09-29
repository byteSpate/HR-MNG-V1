import { apiFetch } from "../client"
import type { ProjectListRow, ProjectStatus, ProjectSummary, SalesTrack } from "../types"

export interface ListProjectsQuery {
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
