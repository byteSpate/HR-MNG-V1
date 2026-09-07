import type {
  SalesAccountStatus,
  SalesChannel,
  SalesContactStatus,
} from "../../generated/prisma/client"

export interface SalesAccountSummary {
  id: string
  name: string
  status: SalesAccountStatus
  ownerEmployeeId: string
  ownerName: string
  assigneeCount: number
  createdAt: string
}

export interface SalesContactSummary {
  id: string
  salesAccountId: string
  name: string
  designation: string | null
  phone: string | null
  email: string | null
  isPrimary: boolean
  status: SalesContactStatus
  /** ISO, or null when nobody has reached this person yet. */
  verifiedAt: string | null
  note: string | null
  createdAt: string
}

export interface SalesCommunicationSummary {
  id: string
  salesAccountId: string
  contactId: string | null
  channel: SalesChannel
  occurredAt: string
  summary: string
  detail: string | null
  /** Frozen at writing. Who made the call, not whoever owns the account now. */
  employeeId: string
  createdAt: string
}

/**
 * One audit row from the account's own trail, or one of its contacts' —
 * the field-by-field record, distinct from the Timeline's "what happened".
 * `before`/`after` are only ever the changed fields, per `writeAudit`'s own
 * contract, never a full snapshot.
 */
export interface AccountHistoryEntry {
  id: string
  entity: "SALES_ACCOUNT" | "SALES_CONTACT"
  entityId: string
  action: string
  changedAt: string
  changedBy: string | null
  before: unknown
  after: unknown
  note: string | null
}

/**
 * One line of an account's story, from either of the two tables that hold it.
 *
 * Rendered rather than raw: the channel is already a label and the author is
 * already a name, so the panel does not need a second round trip to turn
 * WHATSAPP and a uuid into something a person can read.
 */
export interface TimelineItem {
  /** Prefixed by kind, because a communication and an event can share an id. */
  id: string
  kind: "communication" | "event"
  at: string
  title: string
  meta: string | null
  by: string | null
}
