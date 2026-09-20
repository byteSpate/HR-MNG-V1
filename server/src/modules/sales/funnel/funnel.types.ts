/**
 * The shapes the funnel grid is made of (revision §27.6, §27.8, §27.10).
 *
 * The funnel is a *view over deals*, not a store of its own — nothing here is
 * a table. A row is assembled when it is read, which is what lets the grid
 * show a derived offer line and a slipped-date mark without either of them
 * ever being written down (§27.8, §27.15).
 */

import type { OpportunityStage, OpportunityStatus, SalesCommentKind } from "../../../generated/prisma/client"

/** Who took a deal we lost, and with what (§27.4). */
export interface FunnelLostTo {
  partner: string | null
  amount: string | null
  product: string | null
}

/**
 * One remark on a deal. These are the deal's own `SalesComment` rows — the
 * funnel adds no remarks field of its own (§27.8).
 */
export interface FunnelRemark {
  id: string
  kind: SalesCommentKind
  body: string
  authorName: string
  createdAt: string
  /** Written during a Saturday review, and which one. */
  funnelMeetingId: string | null
}

/** One product line of a deal, for the row detail (§27.6). */
export interface FunnelLine {
  product: string
  brand: string | null
  model: string | null
  quantity: number | null
}

/** One line of the grid: one quoted deal, in the sheet's fifteen columns. */
export interface FunnelRow {
  /**
   * The sheet's S/N. Screen position, not an identity — it renumbers when the
   * list is filtered or sorted, exactly as the spreadsheet does (§27.6). The
   * durable handle is `opportunityId`.
   */
  serialNo: number

  opportunityId: string
  /** BS-OPP-00001. The real identity a person can quote back to you. */
  serial: string

  /** The Date column: when we quoted. */
  offeredOn: string | null

  salesAccountId: string
  accountName: string

  /**
   * Headed "Project Name" in the grid because that is what the business calls
   * it, though the field is `Opportunity.name` and no Project table exists
   * (§27.6). The glossary note behind the `?` says so.
   */
  projectName: string

  useCase: string | null

  /** Summarised from the deal's lines: one shows its value, several show the
      first plus "+N more". The full list is in the row detail. */
  brand: string
  model: string
  quantity: string
  lineCount: number
  /** Every line, in order — what "+N more" points at. */
  lines: FunnelLine[]

  amount: string | null
  status: OpportunityStatus
  stage: OpportunityStage

  /** The raw date, for editing. */
  closingDate: string | null
  /** What the cell prints: "Oct 2026", or empty (§27.6). */
  closingDateLabel: string
  /**
   * The sheet's red closing date, derived rather than stored (§27.15). True
   * when the audit log shows the date has been pushed later.
   */
  closingDateSlipped: boolean
  /** What it was before it slipped, so the cell can say what changed. */
  previousClosingDate: string | null

  lostTo: FunnelLostTo
  nextStep: string | null

  /**
   * "We have offered <product> on <date>", composed here and **never
   * stored** (§27.8). Storing it would need an author, and inventing one
   * would be a fake record. Null when there is nothing true to say.
   */
  offerLine: string | null

  remarks: FunnelRemark[]
}

/**
 * Two labelled figures, never one (§27.10).
 *
 * The sheet's own Grand Total quietly includes the lost rows, so a single
 * "Total" means different things to different readers.
 */
export interface FunnelTotals {
  /** Every deal in view. Null when none of them carries a price: zero would be
      a claim, and an unpriced view has made none. */
  quoted: string | null
  quotedCount: number
  /** The deals that are neither Lost nor Cancelled. Null on the same terms. */
  stillOpen: string | null
  stillOpenCount: number
  /** Rows carrying no amount at all. They are in neither figure, and saying
      how many is the difference between a total and a guess. */
  unpricedCount: number
}

export interface FunnelGrid {
  employeeId: string
  employeeName: string
  rows: FunnelRow[]
  /** True when the view holds more deals than `rows` shows. The totals still
      cover every deal in view, so the two can differ and the screen says so. */
  truncated: boolean
  totals: FunnelTotals
}

// ── what the composer is fed ──

export interface FunnelLineInput {
  product: string
  oemBrand: string | null
  model: string | null
  quantity: number | null
  order: number
}

export interface FunnelDealInput {
  id: string
  serial: string
  salesAccountId: string
  accountName: string
  name: string
  useCase: string | null
  offeredOn: Date | null
  amount: unknown
  status: OpportunityStatus
  stage: OpportunityStage
  expectedCloseDate: Date | null
  lostToPartner: string | null
  lostToAmount: unknown
  lostToProduct: string | null
  nextStep: string | null
  lines: FunnelLineInput[]
}

export interface FunnelCommentInput {
  id: string
  entityId: string
  kind: SalesCommentKind
  body: string
  authorName: string
  createdAt: Date
  funnelMeetingId: string | null
}

/**
 * One recorded change to a deal's `expectedCloseDate`, read from the audit
 * log. The funnel stores no flag for this (§27.15).
 */
export interface FunnelCloseChange {
  entityId: string
  from: Date | null
  to: Date | null
  changedAt: Date
}
