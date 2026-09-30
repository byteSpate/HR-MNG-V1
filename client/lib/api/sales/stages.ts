import type { OpportunityStage, SalesTrack } from "../types"

/**
 * Hand copy of `server/src/modules/sales/sales.stages.ts`. Keep the two in
 * step by hand, as `types.ts` already is. The server is the one that decides
 * which stage fits which track — this copy only decides which to offer.
 */
export const NETWORKING_STAGES: OpportunityStage[] = [
  "ASSIGNED_QUALIFIED", "DISCOVERY_DESIGN", "TECHNICAL_VALIDATION",
  "COMMERCIAL_NEGOTIATION", "CUSTOMER_PROCUREMENT", "PO_RECEIVED",
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

/**
 * The two Networking stages that show a box for links to files kept outside
 * the app (Google Drive). The box never blocks a stage change: with no link it
 * only says so. Links are the same rows as the Documents tab, tagged with the
 * stage they were added at.
 */
export const STAGE_LINK_FIELDS: Partial<
  Record<OpportunityStage, { title: string; empty: string; namePlaceholder: string }>
> = {
  DISCOVERY_DESIGN: {
    title: "Design files",
    empty: "No design file link added yet.",
    namePlaceholder: "Design v1",
  },
  COMMERCIAL_NEGOTIATION: {
    title: "Quotation documents",
    empty: "No quotation link added yet.",
    namePlaceholder: "Quotation v1",
  },
}
