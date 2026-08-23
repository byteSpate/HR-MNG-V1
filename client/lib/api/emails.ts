import { apiFetch } from "./client"
import type { EmailDispatchPage } from "./types"

export interface ListEmailsQuery {
  /** One DispatchKind. The server owns the union; this is a plain string. */
  kind?: string
  /** Errored AND never sent — the server's definition, not "has an error". */
  failedOnly?: boolean
  /** The id of the last item on the previous page. */
  cursor?: string
  limit?: number
}

/**
 * The email dispatch log. Super Admin only, enforced server-side — it carries
 * every recipient address in the company.
 */
export function listEmails(
  accessToken: string,
  query: ListEmailsQuery = {}
): Promise<EmailDispatchPage> {
  const params = new URLSearchParams()
  if (query.kind) params.set("kind", query.kind)
  if (query.failedOnly) params.set("failedOnly", "true")
  if (query.cursor) params.set("cursor", query.cursor)
  if (query.limit !== undefined) params.set("limit", String(query.limit))

  const qs = params.toString()
  return apiFetch<EmailDispatchPage>(`/api/emails${qs ? `?${qs}` : ""}`, { accessToken })
}
