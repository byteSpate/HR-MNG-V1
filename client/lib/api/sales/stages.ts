import type { OpportunityStage, SalesTrack } from "../types"

/**
 * Hand copy of `server/src/modules/sales/sales.stages.ts`. Keep the two in
 * step by hand, as `types.ts` already is. The server is the one that decides
 * which stage fits which track — this copy only decides which to offer.
 */
export const NETWORKING_STAGES: OpportunityStage[] = [
  "REQUIREMENT_RECEIVED", "SOLUTION_DESIGN", "OEM_PRICING", "QUOTATION_SUBMITTED", "NEGOTIATION", "AWAITING_DECISION",
]

export const SOFTWARE_STAGES: OpportunityStage[] = [
  "REQUIREMENT_RECEIVED", "REQUIREMENT_GATHERING", "BRD_SENT", "SRS_SENT",
  "PROPOSAL_SUBMITTED", "PROPOSAL_REVISION", "NEGOTIATION", "AWAITING_DECISION",
]

export const stagesFor = (track: SalesTrack): OpportunityStage[] =>
  track === "SOFTWARE_DEVELOPMENT" ? SOFTWARE_STAGES : NETWORKING_STAGES

export const TRACK_LABEL: Record<SalesTrack, string> = {
  NETWORKING: "Networking",
  SOFTWARE_DEVELOPMENT: "Software Development",
}

/** Every track, in the order the picker offers them. */
export const TRACKS: SalesTrack[] = ["NETWORKING", "SOFTWARE_DEVELOPMENT"]
