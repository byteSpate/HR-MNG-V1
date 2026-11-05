import type { OpportunityStage, SalesStage, SalesTrack } from "../../generated/prisma/client"

/**
 * Which stages belong to which track (spec 2026-09-28 §2.4, 2026-09-30). The
 * enum holds every value; this is the one place that says which a track may
 * use, so the validators and the funnel cannot disagree. Order is funnel
 * order. The client keeps a hand copy in client/lib/api/sales/stages.ts.
 */
export const NETWORKING_STAGES: readonly OpportunityStage[] = [
  "ASSIGNED_QUALIFIED", "DISCOVERY_DESIGN", "TECHNICAL_VALIDATION",
  "COMMERCIAL_NEGOTIATION", "CUSTOMER_PROCUREMENT", "PO_RECEIVED",
]

export const SOFTWARE_STAGES: readonly OpportunityStage[] = [
  "REQUIREMENT_RECEIVED", "REQUIREMENT_GATHERING", "BRD_SENT", "SRS_SENT",
  "PROPOSAL_SUBMITTED", "PROPOSAL_REVISION", "NEGOTIATION", "AWAITING_DECISION",
]

export function stagesFor(track: SalesTrack): readonly OpportunityStage[] {
  return track === "SOFTWARE_DEVELOPMENT" ? SOFTWARE_STAGES : NETWORKING_STAGES
}

/** Where a new Opportunity of this track starts, and where it goes back to when its track changes. */
export function firstStageFor(track: SalesTrack): OpportunityStage {
  return stagesFor(track)[0]
}

export function stageFitsTrack(stage: OpportunityStage, track: SalesTrack): boolean {
  return stagesFor(track).includes(stage)
}

export const WRONG_TRACK_STAGE: Record<SalesTrack, string> = {
  NETWORKING: "That stage is for Software Development Opportunities. Pick a Networking stage.",
  SOFTWARE_DEVELOPMENT: "That stage is for Networking Opportunities. Pick a Software Development stage.",
}

/**
 * The stages at which an offer has gone out, on either track. Reaching any of
 * them the first time stamps the offer date and puts the Opportunity in the
 * funnel (revision §27.2). Stages are free-form, so the later ones count too:
 * a deal that skips straight to stage 5 still joins the funnel.
 */
export const QUOTED_STAGES: ReadonlySet<string> = new Set([
  // Networking: the commercial proposal is made and sent from stage 4 on.
  "COMMERCIAL_NEGOTIATION",
  "CUSTOMER_PROCUREMENT",
  "PO_RECEIVED",
  // Software.
  "PROPOSAL_SUBMITTED",
  "PROPOSAL_REVISION",
  "NEGOTIATION",
  "AWAITING_DECISION",
])

/**
 * The stages before the first quote goes out (owner, 2026-11-02): Networking's
 * first three and Software's first four. Software's SRS sent is also before the
 * quote, which is why the two tracks differ. Worked out from the lists above, so
 * a new stage is placed in one spot only.
 */
export const BEFORE_QUOTE_STAGES: Record<SalesTrack, readonly OpportunityStage[]> = {
  NETWORKING: NETWORKING_STAGES.filter((stage) => !QUOTED_STAGES.has(stage)),
  SOFTWARE_DEVELOPMENT: SOFTWARE_STAGES.filter((stage) => !QUOTED_STAGES.has(stage)),
}

/**
 * The stages where the price is talked over again (owner, 2026-10-13):
 * Software's Proposal revision and Negotiation (the team's "Quotation
 * Revision"). Moving into one offers a new quote, with Skip.
 */
export const REVISION_STAGES: ReadonlySet<string> = new Set(["PROPOSAL_REVISION", "NEGOTIATION"])

/**
 * What the stage change asks for. REQUIRED: the first move into a quote
 * stage needs Quote 1 (or "Move without a quote" with a reason). OPTIONAL:
 * a revision stage offers a new quote. Null: nothing to ask.
 */
export function quoteAskFor(
  stage: OpportunityStage,
  opp: { offeredOn: Date | string | null },
): "REQUIRED" | "OPTIONAL" | null {
  if (QUOTED_STAGES.has(stage) && !opp.offeredOn) return "REQUIRED"
  if (REVISION_STAGES.has(stage)) return "OPTIONAL"
  return null
}

// ── Sales stages: where the customer is in buying (spec 2026-11-05) ──
//
// They sit next to the work stages above and never replace them. The enum holds
// every value; these lists say which belong to which track. Networking names are
// management's. Software names are a proposal that management still checks.

export const NETWORKING_SALES_STAGES: readonly SalesStage[] = [
  "PENDING_INITIAL_MEETING", "AWARENESS", "RESEARCH_AND_INTERNAL_EDUCATION",
  "BUDGET_AND_TIMING_DETERMINATION", "PROJECT_FUNDED_AND_KICKED_OFF",
  "SOLUTION_SHARED_COMPETITIVE_POSITION", "SOLUTION_FRONT_RUNNER",
  "RECOMMENDATION_TO_FUND", "DECISION_TO_FUND", "PURCHASE_ORDER_RECEIVED",
]

export const SOFTWARE_SALES_STAGES: readonly SalesStage[] = [
  "PENDING_INITIAL_MEETING", "NEED_UNDERSTOOD", "CUSTOMER_IS_COMPARING_OPTIONS",
  "BUDGET_AND_TIMING_KNOWN", "PROJECT_FUNDED_AND_SCOPE_AGREED",
  "WE_ARE_ONE_OF_THE_OPTIONS", "WE_ARE_THE_FAVOURITE",
  "RECOMMENDATION_TO_BUY", "DECISION_TO_BUY", "WORK_ORDER_RECEIVED",
]

export function salesStagesFor(track: SalesTrack): readonly SalesStage[] {
  return track === "SOFTWARE_DEVELOPMENT" ? SOFTWARE_SALES_STAGES : NETWORKING_SALES_STAGES
}

export function salesStageFitsTrack(stage: SalesStage, track: SalesTrack): boolean {
  return salesStagesFor(track).includes(stage)
}

/** Stage 10 of the track. An Opportunity that is Won gets it. */
export function lastSalesStageFor(track: SalesTrack): SalesStage {
  const list = salesStagesFor(track)
  return list[list.length - 1]
}

export const WRONG_TRACK_SALES_STAGE: Record<SalesTrack, string> = {
  NETWORKING: "That sales stage is for Software Development Opportunities. Pick a Networking sales stage.",
  SOFTWARE_DEVELOPMENT: "That sales stage is for Networking Opportunities. Pick a Software Development sales stage.",
}

export const PAIR_REFUSAL =
  "These two stages do not fit together. Pick a sales stage that fits this work stage, or save with a reason."

/**
 * Which sales stages each work stage allows, as the first and last position
 * (1 to 10) in the track's sales list. Work stage names are unique across the
 * two tracks, so one record serves both. A guess made for management to check
 * (spec 2026-11-05). The client keeps a hand copy in
 * `client/lib/api/sales/sales-stages.ts`.
 */
const SALES_RANGE: Record<OpportunityStage, readonly [number, number]> = {
  ASSIGNED_QUALIFIED: [1, 4],
  DISCOVERY_DESIGN: [2, 5],
  TECHNICAL_VALIDATION: [2, 7],
  COMMERCIAL_NEGOTIATION: [5, 9],
  CUSTOMER_PROCUREMENT: [8, 9],
  PO_RECEIVED: [10, 10],
  REQUIREMENT_RECEIVED: [1, 4],
  REQUIREMENT_GATHERING: [2, 4],
  BRD_SENT: [2, 7],
  SRS_SENT: [2, 7],
  PROPOSAL_SUBMITTED: [2, 9],
  PROPOSAL_REVISION: [5, 9],
  NEGOTIATION: [5, 9],
  AWAITING_DECISION: [5, 9],
}

export function salesStageFitsWork(track: SalesTrack, work: OpportunityStage, sales: SalesStage): boolean {
  const position = salesStagesFor(track).indexOf(sales) + 1
  if (position === 0) return false
  const [min, max] = SALES_RANGE[work]
  return position >= min && position <= max
}
