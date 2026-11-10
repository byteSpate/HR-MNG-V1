import { apiFetch } from "../client"
import type { ContactDirectoryPage, SalesContactStatus } from "../types"

/** "added" is the date the contact was added: the default, newest first. */
export type ContactSort = "added" | "name" | "designation" | "account" | "industry" | "status"

/** The Contacts page: every contact the viewer may see, searched, sorted and paged (owner, 2026-10-18). */
export function listAllContacts(
  accessToken: string,
  query: { q: string; industry: string; status: SalesContactStatus | ""; page: number; sort: ContactSort; dir: "asc" | "desc" }
): Promise<ContactDirectoryPage> {
  const search = new URLSearchParams({ page: String(query.page), sort: query.sort, dir: query.dir })
  if (query.q.trim()) search.set("q", query.q.trim())
  if (query.industry) search.set("industry", query.industry)
  if (query.status) search.set("status", query.status)
  return apiFetch<ContactDirectoryPage>(`/api/sales/contacts?${search.toString()}`, { accessToken })
}
