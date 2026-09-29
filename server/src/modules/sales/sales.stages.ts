import type { OpportunityStage, SalesTrack } from "../../generated/prisma/client"

/**
 * Which stages belong to which track (spec 2026-09-28 §2.4). The enum holds
 * every value; this is the one place that says which a track may use, so the
 * validators and the funnel cannot disagree. Order is funnel order. The client
 * keeps a hand copy in client/lib/api/sales/stages.ts.
 */
export const NETWORKING_STAGES: readonly OpportunityStage[] = [
  "REQUIREMENT_RECEIVED", "SOLUTION_DESIGN", "OEM_PRICING", "QUOTATION_SUBMITTED", "NEGOTIATION", "AWAITING_DECISION",
]

export const SOFTWARE_STAGES: readonly OpportunityStage[] = [
  "REQUIREMENT_RECEIVED", "REQUIREMENT_GATHERING", "BRD_SENT", "SRS_SENT",
  "PROPOSAL_SUBMITTED", "PROPOSAL_REVISION", "NEGOTIATION", "AWAITING_DECISION",
]

export function stagesFor(track: SalesTrack): readonly OpportunityStage[] {
  return track === "SOFTWARE_DEVELOPMENT" ? SOFTWARE_STAGES : NETWORKING_STAGES
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
 * funnel (revision §27.2). Stages are free-form, so the later ones count too.
 */
export const QUOTED_STAGES: ReadonlySet<string> = new Set([
  "QUOTATION_SUBMITTED",
  "PROPOSAL_SUBMITTED",
  "PROPOSAL_REVISION",
  "NEGOTIATION",
  "AWAITING_DECISION",
])
