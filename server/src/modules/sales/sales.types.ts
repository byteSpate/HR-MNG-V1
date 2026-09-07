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
