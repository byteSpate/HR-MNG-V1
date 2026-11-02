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
 * The stages that show a box for links to files kept outside the app (Google
 * Drive): Design files and Costing and BOQ link, and from 2026-11-02 four more
 * for the early stages. The box never blocks a stage change: with no link it
 * only says so. Links are the same rows as the Documents tab, tagged with the
 * stage they were added at.
 */
export const STAGE_LINK_FIELDS: Partial<
  Record<OpportunityStage, { title: string; empty: string; namePlaceholder: string; kind?: "COSTING_BOQ" }>
> = {
  DISCOVERY_DESIGN: {
    title: "Design files",
    empty: "No design file link added yet.",
    namePlaceholder: "Design v1",
  },
  // Was "Quotation documents" (owner, 2026-10-18). Each link may belong to a
  // quote, and only Sales Admins and Super Admins can open them.
  COMMERCIAL_NEGOTIATION: {
    title: "Costing and BOQ link",
    empty: "No costing or BOQ link added yet.",
    namePlaceholder: "Costing v1",
    kind: "COSTING_BOQ",
  },
  // Early stages (owner, 2026-11-02). Each is a link to a file, nothing more.
  TECHNICAL_VALIDATION: {
    title: "Validation report",
    empty: "No validation report link added yet.",
    namePlaceholder: "Validation v1",
  },
  REQUIREMENT_RECEIVED: {
    title: "Requirement document",
    empty: "No requirement document link added yet.",
    namePlaceholder: "Requirement v1",
  },
  BRD_SENT: {
    title: "BRD file",
    empty: "No BRD link added yet.",
    namePlaceholder: "BRD v1",
  },
  SRS_SENT: {
    title: "SRS file",
    empty: "No SRS link added yet.",
    namePlaceholder: "SRS v1",
  },
}

/**
 * The stages at which a quote has gone out (hand copy of the server's
 * `QUOTED_STAGES`). Reaching one the first time puts the Opportunity on the
 * Funnel.
 */
export const QUOTED_STAGES: ReadonlySet<OpportunityStage> = new Set<OpportunityStage>([
  "COMMERCIAL_NEGOTIATION", "CUSTOMER_PROCUREMENT", "PO_RECEIVED",
  "PROPOSAL_SUBMITTED", "PROPOSAL_REVISION", "NEGOTIATION", "AWAITING_DECISION",
])

/**
 * The stages before the first quote goes out (owner, 2026-11-02): Networking's
 * first three and Software's first four. A hand copy of the server's
 * `BEFORE_QUOTE_STAGES`; the Before Quotation view uses it to name the stages.
 */
export const BEFORE_QUOTE_STAGES: Record<SalesTrack, OpportunityStage[]> = {
  NETWORKING: NETWORKING_STAGES.filter((stage) => !QUOTED_STAGES.has(stage)),
  SOFTWARE_DEVELOPMENT: SOFTWARE_STAGES.filter((stage) => !QUOTED_STAGES.has(stage)),
}

/** Where the price is talked over again: Proposal revision and Negotiation ("Quotation Revision"). */
export const REVISION_STAGES: ReadonlySet<OpportunityStage> = new Set<OpportunityStage>(["PROPOSAL_REVISION", "NEGOTIATION"])

/**
 * What the stage change asks for (owner, 2026-10-13). REQUIRED: the first
 * move into a quote stage needs Quote 1, or "Move without a quote". OPTIONAL:
 * a revision stage offers a new quote. Null: nothing to ask. The server
 * checks the same rule.
 */
export function quoteAskFor(
  stage: OpportunityStage,
  opp: { offeredOn: string | null }
): "REQUIRED" | "OPTIONAL" | null {
  if (QUOTED_STAGES.has(stage) && !opp.offeredOn) return "REQUIRED"
  if (REVISION_STAGES.has(stage)) return "OPTIONAL"
  return null
}
