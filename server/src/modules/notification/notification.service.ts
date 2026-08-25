/**
 * The read side of the dispatch log.
 *
 * A log, not a queue — there is nothing here that retries, requeues or
 * resends. A resend would need the body and the attachments, which this table
 * deliberately does not store, so it stays on the page that owns the thing:
 * the payroll run page for payslips, Reissue credentials for logins.
 */

import prisma from "../../config/prisma"

export interface DispatchItem {
  id: string
  to: string
  kind: string
  subject: string
  entity: string | null
  entityId: string | null
  /** The mail server accepted it. NOT proof a person received it. */
  sentAt: string | null
  error: string | null
  createdAt: string
}

export interface DispatchQuery {
  kind?: string
  failedOnly?: boolean
  cursor?: string
  limit?: number
}

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200

export async function listDispatches(
  q: DispatchQuery
): Promise<{ items: DispatchItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(q.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)

  // Failed means errored AND never sent, the same rule the payslip status
  // counts use: a row that succeeded and later errored is not a failure.
  const where = {
    ...(q.kind ? { kind: q.kind } : {}),
    ...(q.failedOnly ? { error: { not: null }, sentAt: null } : {}),
  }

  // One row more than asked for, so "is there another page" is answered by
  // the query rather than by a second count that can disagree with it.
  const rows = await prisma.emailDispatch.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  })

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  return {
    items: page.map((r) => ({
      id: r.id,
      to: r.to,
      kind: r.kind,
      subject: r.subject,
      entity: r.entity,
      entityId: r.entityId,
      sentAt: r.sentAt ? r.sentAt.toISOString() : null,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  }
}
