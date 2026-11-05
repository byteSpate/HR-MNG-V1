import type { OpportunityStage, SalesStage, SalesTrack } from "../types"
import { stagesFor } from "./stages"

/**
 * Hand copy of the sales stage lists and the rule table in
 * `server/src/modules/sales/sales.stages.ts` (spec 2026-11-05). Keep the two in
 * step by hand, as `stages.ts` already is. The server decides which pair is
 * allowed. This copy only decides what to offer, and where to move the other
 * stage so the user is never asked to pick twice.
 */
export const NETWORKING_SALES_STAGES: SalesStage[] = [
  "PENDING_INITIAL_MEETING", "AWARENESS", "RESEARCH_AND_INTERNAL_EDUCATION",
  "BUDGET_AND_TIMING_DETERMINATION", "PROJECT_FUNDED_AND_KICKED_OFF",
  "SOLUTION_SHARED_COMPETITIVE_POSITION", "SOLUTION_FRONT_RUNNER",
  "RECOMMENDATION_TO_FUND", "DECISION_TO_FUND", "PURCHASE_ORDER_RECEIVED",
]

export const SOFTWARE_SALES_STAGES: SalesStage[] = [
  "PENDING_INITIAL_MEETING", "NEED_UNDERSTOOD", "CUSTOMER_IS_COMPARING_OPTIONS",
  "BUDGET_AND_TIMING_KNOWN", "PROJECT_FUNDED_AND_SCOPE_AGREED",
  "WE_ARE_ONE_OF_THE_OPTIONS", "WE_ARE_THE_FAVOURITE",
  "RECOMMENDATION_TO_BUY", "DECISION_TO_BUY", "WORK_ORDER_RECEIVED",
]

export const salesStagesFor = (track: SalesTrack): SalesStage[] =>
  track === "SOFTWARE_DEVELOPMENT" ? SOFTWARE_SALES_STAGES : NETWORKING_SALES_STAGES

/** First and last allowed position (1 to 10) in the track's sales list, per work stage. */
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

export function fitsPair(track: SalesTrack, work: OpportunityStage, sales: SalesStage): boolean {
  const position = salesStagesFor(track).indexOf(sales) + 1
  if (position === 0) return false
  const [min, max] = SALES_RANGE[work]
  return position >= min && position <= max
}

/** The sales stage closest to `sales` that the work stage allows. */
export function nearestSalesStage(track: SalesTrack, work: OpportunityStage, sales: SalesStage): SalesStage {
  const list = salesStagesFor(track)
  const [min, max] = SALES_RANGE[work]
  const position = list.indexOf(sales) + 1
  const clamped = Math.min(Math.max(position, min), max)
  return list[clamped - 1]
}

/** The work stage closest to `work` that allows `sales`. On a tie the earlier stage wins. */
export function nearestWorkStage(track: SalesTrack, work: OpportunityStage, sales: SalesStage): OpportunityStage {
  const stages = stagesFor(track)
  const from = stages.indexOf(work)
  let best = work
  let bestDistance = Infinity
  stages.forEach((candidate, index) => {
    if (!fitsPair(track, candidate, sales)) return
    const distance = Math.abs(index - from)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  })
  return best
}

export function nextWorkStage(track: SalesTrack, work: OpportunityStage): OpportunityStage | null {
  const stages = stagesFor(track)
  return stages[stages.indexOf(work) + 1] ?? null
}

export interface StagePair {
  work: OpportunityStage
  sales: SalesStage | null
}

/**
 * The one-pick rule. The user changes one stage. The other stays if it still
 * fits, and otherwise moves to the nearest allowed value, with `moved` saying
 * which one moved so the dialog can tell the user. A missing sales stage stays
 * missing when the work stage changes: it is never guessed.
 */
export function pickPair(
  track: SalesTrack,
  current: StagePair,
  change: { work: OpportunityStage } | { sales: SalesStage | null }
): StagePair & { moved: "work" | "sales" | null } {
  if ("work" in change) {
    const work = change.work
    if (current.sales === null || fitsPair(track, work, current.sales)) return { work, sales: current.sales, moved: null }
    return { work, sales: nearestSalesStage(track, work, current.sales), moved: "sales" }
  }
  const sales = change.sales
  // Not set: there is nothing to fit, so the work stage stays where it is.
  if (sales === null) return { work: current.work, sales: null, moved: null }
  if (fitsPair(track, current.work, sales)) return { work: current.work, sales, moved: null }
  return { work: nearestWorkStage(track, current.work, sales), sales, moved: "work" }
}
