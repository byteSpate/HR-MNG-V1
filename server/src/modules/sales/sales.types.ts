import type {
  SalesAccountStatus,
  SalesChannel,
  SalesContactStatus,
} from "../../generated/prisma/client"

export interface SalesAccountSummary {
  id: string
  name: string
  industry: string | null
  website: string | null
  address: string | null
  status: SalesAccountStatus
  ownerEmployeeId: string
  ownerName: string
  assigneeCount: number
  /** Named, not just counted — "All Accounts" shows who, not just how many. */
  assignees: { id: string; fullName: string }[]
  /**
   * Owner, assignee, or admin — computed per viewer, not stored. Lets the
   * client hide write controls on an account it can only read, without
   * duplicating requireAccountAccess's rule client-side.
   */
  canManage: boolean
  /**
   * Whether the *owner* can still work this account — a granted sales role,
   * employment that has not ended, and a login that still works.
   *
   * Eligibility is checked when an account is created, but ownership outlives
   * that moment: revoking hub access or recording an exit leaves the account
   * still naming them. Neither operation is blocked — HR's workflow is not
   * the hub's to gate — so this surfaces the resulting state instead, and a
   * Sales Admin can find the accounts that need a new owner.
   */
  ownerActive: boolean
  /**
   * Narrower than `canManage`, and not merely a nicety: `SalesCommunication`
   * has a required `employeeId`, so logging a call is impossible for an
   * account with no Employee row behind it — Super Admin and HR Admin are
   * seeded exactly that way. They pass every permission check and then take
   * a 400 from `logCommunication`, so a "Log a call" button offered to them
   * is a control that cannot do anything.
   */
  canLogActivity: boolean
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
/**
 * One changed field, already rendered for reading: the label is a phrase
 * rather than a column name, and any id has been resolved to a person's name.
 */
export interface HistoryChange {
  /** The raw column, kept so the client can key a list without using the label. */
  field: string
  label: string
  /** Null when the field was set for the first time — show one value, not an arrow. */
  before: string | null
  after: string
}

export interface AccountHistoryEntry {
  id: string
  entity: "SALES_ACCOUNT" | "SALES_CONTACT"
  entityId: string
  action: string
  changedAt: string
  /** Resolved to a name. Null when nothing recorded who did it. */
  changedByName: string | null
  changes: HistoryChange[]
  note: string | null
}

/**
 * One page of an account's history.
 *
 * Wrapped rather than a bare array so a truncated read can say so. Silently
 * returning the newest hundred of five hundred rows would look identical to
 * an account with a hundred rows, and the panel would have no way to tell the
 * reader that there is more.
 */
export interface AccountHistory {
  items: AccountHistoryEntry[]
  /** More rows exist beyond `limit`. Paging is Phase 2. */
  truncated: boolean
  limit: number
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
  /** The long-form note on a communication. Null for an event — those have
      no free-text body of their own. */
  detail: string | null
}
