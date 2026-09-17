import type {
  OpportunityStage,
  OpportunityStatus,
  SalesCommentKind,
  SalesTrack,
  SalesAccountStatus,
  SalesChannel,
  SalesContactStatus,
} from "../../generated/prisma/client"
import type { DashboardStat, Tone as DashboardTone } from "../dashboard/dashboard.types"
import type { SalesTargetQuarter } from "./target.service"
import type { MinutesKind, SectionContent } from "./minutes.content"

export interface OpportunityLineSummary {
  id: string
  opportunityId: string
  product: string
  oemBrand: string | null
  model: string | null
  quantity: number | null
  unitValue: string | null
  lineValue: string | null
  /** The profit as a percentage of `lineValue`, "-100.00" to "100.00". Null is "no margin yet". */
  marginPercent: string | null
  /** `lineValue` times `marginPercent`, worked out when read. Null when either is missing — never "0.00". */
  marginAmount: string | null
  note: string | null
  order: number
  createdAt: string
  updatedAt: string
}

export interface OpportunitySummary {
  id: string
  serial: string
  salesAccountId: string
  salesAccountName: string
  name: string
  track: SalesTrack
  amount: string | null
  currency: string
  /** The deal's margin: its products' margins added up. Null when no product carries one — never "0.00". */
  marginAmount: string | null
  /** Products whose margin cannot be worked out: no Total price, or no percentage. */
  unmarginedLineCount: number
  expectedCloseDate: string | null
  oemAccountManager: string | null
  status: OpportunityStatus
  statusReason: string | null
  closedAt: string | null
  stage: OpportunityStage
  stageChangedAt: string
  nextStep: string | null
  nextStepDueOn: string | null
  ownerEmployeeId: string
  ownerName: string
  wonByEmployeeId: string | null
  lastActivityAt: string
  createdAt: string
  updatedAt: string
  lines: OpportunityLineSummary[]
  lineTotal: string
  unpricedLineCount: number
  amountDiffersFromLines: boolean
  /** Whether this viewer may change the deal. The directory is shared, so
      seeing one and being able to work it are different questions. */
  canManage: boolean
}

export interface SalesCommentSummary {
  id: string
  entity: "SALES_ACCOUNT" | "OPPORTUNITY"
  entityId: string
  kind: SalesCommentKind
  body: string
  authorUserId: string
  authorEmployeeId: string | null
  authorName: string
  createdAt: string
  updatedAt: string
}

export interface SalesCommentPage {
  items: SalesCommentSummary[]
  truncated: boolean
  limit: number
}

export interface SalesAccountSummary {
  id: string
  name: string
  industry: string | null
  website: string | null
  address: string | null
  status: SalesAccountStatus
  /**
   * Why the account is Inactive or Do Not Contact. The service requires one
   * whenever the status leaves ACTIVE and clears it on the way back, so a
   * status badge is never rendered without the sentence explaining it.
   */
  statusReason: string | null
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

export interface OpportunityHistoryEntry extends Omit<AccountHistoryEntry, "entity"> {
  entity: "OPPORTUNITY" | "OPPORTUNITY_LINE"
}

export interface OpportunityHistory {
  items: OpportunityHistoryEntry[]
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
  kind: "communication" | "event" | "comment" | "meeting" | "task"
  at: string
  title: string
  meta: string | null
  by: string | null
  /** The long-form note on a communication. Null for an event — those have
      no free-text body of their own. */
  detail: string | null
}

// ── MEETINGS (phase 3) ─────────────────────────────────────────────────────

export interface SalesMeetingAttendeeSummary {
  id: string
  side: "OURS" | "THEIRS"
  employeeId: string | null
  contactId: string | null
  /** From the employee or contact record when there is one, else as typed. */
  name: string
  designation: string | null
}

export interface SalesMeetingSummary {
  id: string
  salesAccountId: string
  salesAccountName: string
  opportunityId: string | null
  opportunitySerial: string | null
  opportunityName: string | null
  title: string
  mode: "CUSTOMER_SITE" | "OUR_OFFICE" | "ONLINE"
  scheduledAt: string
  endsAt: string | null
  location: string | null
  notes: string | null
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED"
  cancelReason: string | null
  outcome: string | null
  completedAt: string | null
  attendees: SalesMeetingAttendeeSummary[]
  /**
   * The meeting's minutes, once started (phase 4). Shown to everyone who can
   * see the meeting: that they exist is not what they say (§25.27).
   */
  minutes: { id: string; status: SalesMinutesStatus; lastSentAt: string | null } | null
  /** Whether the viewer works the account, and so may change the meeting. */
  canManage: boolean
}

// ── MEETING MINUTES (phase 4) ──────────────────────────────────────────────

export type SalesMinutesStatus = "DRAFT" | "SENT" | "EDITED_AFTER_SENDING"

/** One minutes document, for the people who work the account. */
export interface SalesMinutesDetail {
  id: string
  meetingId: string
  status: SalesMinutesStatus
  lastSentAt: string | null
  purpose: string | null
  meetingWithNote: string | null
  /** The requirement question's answer; null until answered. */
  requirementFound: boolean | null
  /** The meeting has no deal, so the question is asked (§25.6). */
  asksRequirement: boolean
  /** Sent at least once, so the answer can no longer change. */
  requirementLocked: boolean
  /** "Meeting Minutes – APS Group". */
  title: string
  /** The meeting's title. */
  subtitle: string
  /** The header's labelled lines, exactly as the PDF prints them. */
  header: { label: string; value: string }[]
  fileName: string
  companyName: string
  meeting: {
    id: string
    title: string
    scheduledAt: string
    endsAt: string | null
    status: "SCHEDULED" | "COMPLETED" | "CANCELLED"
    salesAccountId: string
    salesAccountName: string
    opportunityId: string | null
    opportunitySerial: string | null
    opportunityName: string | null
  }
  attendees: { side: "OURS" | "THEIRS"; name: string; designation: string | null }[]
  sections: { heading: string; kind: MinutesKind; content: SectionContent }[]
  preparers: { employeeId: string; name: string; title: string | null; titleExtra: string | null }[]
  /** Every copy downloaded for sending, newest first. Each is kept exactly as it went out. */
  sends: { id: string; sentAt: string; sentByName: string | null; sentTo: string | null; fileName: string }[]
  /** One line per save and per send (§25.35), newest first. */
  history: { id: string; at: string; byName: string | null; text: string }[]
  /** Deals made from this meeting (Opportunity.meetingId). */
  originatedDeals: { id: string; serial: string; name: string }[]
  /** Only before the first send (§25.9). */
  canDelete: boolean
}

/** One row of the Meeting Minutes page (§25.28). */
export interface SalesMinutesListItem {
  id: string
  meetingId: string
  meetingTitle: string
  scheduledAt: string
  salesAccountId: string
  salesAccountName: string
  preparedBy: string[]
  status: SalesMinutesStatus
  lastSentAt: string | null
}

// ── TASKS (phase 3) ────────────────────────────────────────────────────────

export interface SalesTaskSummary {
  id: string
  origin: "SELF" | "FUNNEL_MEETING"
  /** Always set in phase 3; nullable because a phase 5 project task may have no account. */
  salesAccountId: string | null
  salesAccountName: string | null
  opportunityId: string | null
  opportunitySerial: string | null
  opportunityName: string | null
  meetingId: string | null
  meetingTitle: string | null
  title: string
  detail: string | null
  /** YYYY-MM-DD. */
  dueOn: string
  priority: "LOW" | "NORMAL" | "HIGH"
  assignedToEmployeeId: string
  assignedToName: string
  status: "PENDING" | "DONE" | "CANCELLED"
  outcome: string | null
  cancelReason: string | null
  completedAt: string | null
  /** Pending and due before today in office time. Worked out when read, never stored. */
  overdue: boolean
  /** Only the owner changes a task, a Sales Admin included. */
  canManage: boolean
  createdAt: string
}

export interface SalesTaskStatusResult extends SalesTaskSummary {
  /** After Done, the date to offer for the next follow-up: today plus 15 days. Null otherwise. */
  nextFollowUpOn: string | null
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────
// DashboardStat and Tone are imported rather than redeclared: the sales hub
// renders through the same record kit as every role dashboard, so a second
// definition here would be a second answer to what a stat looks like.

/**
 * One Band 2 row: something that needs doing, with the count and the link to
 * the filtered list behind it.
 */
export interface SalesActionRow {
  key: string
  label: string
  count: number
  /** The sentence under the count. Never a bare number repeated. */
  detail: string
  tone: DashboardTone
  /** Role-agnostic, as every sales href is. The client prefixes /sales. */
  href: string
}

/** One person in the admin roll-up. Every row names who it is about. */
export interface SalesTeamRow {
  employeeId: string
  employeeName: string
  /** This quarter's target in taka, carry included. Null means none set — never "0.00". */
  target: string | null
  /** Value of the deals this person won this quarter. */
  valueWon: string
  dealsWon: number
  ongoing: number
}

export interface SalesDashboardPayload {
  scope: "me" | "employee" | "all"
  employeeId: string | null
  employeeName: string
  calendarYear: number
  quarter: number
  /** Band 1. Presentation-ready, tone chosen here and not in the client. */
  stats: DashboardStat[]
  /** The Q1 to Q4 table. A quarter with no target carries null, never zero. */
  quarters: SalesTargetQuarter[]
  /** Band 2, only the rows that have a table behind them. */
  actions: SalesActionRow[]
  /** Present only for the admin roll-up. */
  team?: SalesTeamRow[]
  /** Keyed by href, counted once, so a card and its nav badge cannot drift. */
  badges: Record<string, number>
  /**
   * What this page cannot show yet, so it can say so in words. An empty
   * "Tasks due" row would read as "no tasks", which is a number nobody
   * measured.
   */
  notBuilt: string[]
}
