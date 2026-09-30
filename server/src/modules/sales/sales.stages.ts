import type { OpportunityStage, SalesTrack } from "../../generated/prisma/client"

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
