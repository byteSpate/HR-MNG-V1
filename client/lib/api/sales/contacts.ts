import { apiFetch } from "../client"
import type { ContactDirectoryPage } from "../types"

export type ContactSort = "name" | "designation" | "account" | "status"

/** The Contacts page: every contact the viewer may see, searched, sorted and paged (owner, 2026-10-18). */
export function listAllContacts(
  accessToken: string,
  query: { q: string; page: number; sort: ContactSort; dir: "asc" | "desc" }
): Promise<ContactDirectoryPage> {
  const search = new URLSearchParams({ page: String(query.page), sort: query.sort, dir: query.dir })
  if (query.q.trim()) search.set("q", query.q.trim())
  return apiFetch<ContactDirectoryPage>(`/api/sales/contacts?${search.toString()}`, { accessToken })
}
