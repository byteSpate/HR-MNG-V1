import type { SalesStage } from "../types"

/**
 * The names of the sales stages, and a short "what it means, with an example"
 * line for each (spec 2026-11-05). Networking names are management's, exactly as
 * they wrote them. Software names are a proposal that management still checks.
 * The example customer is invented.
 */
export const SALES_STAGE_LABEL: Record<SalesStage, string> = {
  PENDING_INITIAL_MEETING: "Pending Initial Meeting",
  // Networking
  AWARENESS: "Awareness",
  RESEARCH_AND_INTERNAL_EDUCATION: "Research and Internal Education",
  BUDGET_AND_TIMING_DETERMINATION: "Budget and Timing Determination",
  PROJECT_FUNDED_AND_KICKED_OFF: "Project Funded and Kicked-Off",
  SOLUTION_SHARED_COMPETITIVE_POSITION: "Solution - Shared Competitive Position",
  SOLUTION_FRONT_RUNNER: "Solution - Front Runner",
  RECOMMENDATION_TO_FUND: "Recommendation to Fund F5 Purchase",
  DECISION_TO_FUND: "Decision to Fund F5 Purchase",
  PO_RECEIVED_BY_VAR: "PO Received by VAR",
  // Software
  NEED_UNDERSTOOD: "Need Understood",
  CUSTOMER_IS_COMPARING_OPTIONS: "Customer Is Comparing Options",
  BUDGET_AND_TIMING_KNOWN: "Budget and Timing Known",
  PROJECT_FUNDED_AND_SCOPE_AGREED: "Project Funded and Scope Agreed",
  WE_ARE_ONE_OF_THE_OPTIONS: "We Are One of the Options",
  WE_ARE_THE_FAVOURITE: "We Are the Favourite",
  RECOMMENDATION_TO_BUY: "Recommendation to Buy",
  DECISION_TO_BUY: "Decision to Buy",
  WORK_ORDER_RECEIVED: "Work Order Received",
}

export const SALES_STAGE_HELP: Record<SalesStage, { meaning: string; example: string }> = {
  PENDING_INITIAL_MEETING: {
    meaning: "We know the customer, but the first meeting has not happened.",
    example: "Example: the IT head of ABC Bank agreed to meet us next week. Nothing is discussed yet.",
  },
  AWARENESS: {
    meaning: "The customer knows they have a need and talks with us about it. They are not studying options yet.",
    example: "Example: ABC Bank says their network is slow and asks what is possible.",
  },
  RESEARCH_AND_INTERNAL_EDUCATION: {
    meaning: "The customer is learning and teaching their own team.",
    example: "Example: ABC Bank asks for product sheets and a demo for its security team.",
  },
  BUDGET_AND_TIMING_DETERMINATION: {
    meaning: "The customer is working out how much money they have and when they will buy.",
    example: "Example: ABC Bank says the budget will be set at the January meeting.",
  },
  PROJECT_FUNDED_AND_KICKED_OFF: {
    meaning: "The money is approved and the customer has started the project. Both are on the customer's side. This is not about us starting delivery.",
    example: "Example: ABC Bank sends the approved budget code, names a project owner, and holds a first project meeting on 12 December.",
  },
  SOLUTION_SHARED_COMPETITIVE_POSITION: {
    meaning: "The customer is looking at our solution and at least one other.",
    example: "Example: ABC Bank is testing our offer and a competitor's offer.",
  },
  SOLUTION_FRONT_RUNNER: {
    meaning: "The customer prefers us, but has not decided.",
    example: "Example: ABC Bank's team tells us we are their first choice.",
  },
  RECOMMENDATION_TO_FUND: {
    meaning: "The customer's team formally recommends buying, to the people who approve money.",
    example: "Example: ABC Bank's IT head sends the recommendation to the board.",
  },
  DECISION_TO_FUND: {
    meaning: "The people who approve money say yes.",
    example: "Example: the ABC Bank board approves the purchase.",
  },
  PO_RECEIVED_BY_VAR: {
    meaning: "The purchase order has arrived.",
    example: "Example: ABC Bank's purchase order is in our hands.",
  },
  NEED_UNDERSTOOD: {
    meaning: "We know, in simple words, what the customer needs built.",
    example: "Example: a company needs a payroll portal for 200 staff.",
  },
  CUSTOMER_IS_COMPARING_OPTIONS: {
    meaning: "The customer looks at other companies, or at building it themselves.",
    example: "Example: they ask two other companies for ideas.",
  },
  BUDGET_AND_TIMING_KNOWN: {
    meaning: "The customer has told us how much money they have and by when they want it.",
    example: "Example: \"Up to 15 lakh taka, live by March.\"",
  },
  PROJECT_FUNDED_AND_SCOPE_AGREED: {
    meaning: "The money is approved and both sides agree what will be built.",
    example: "Example: the budget is approved and the customer signs off the requirements (BRD or SRS).",
  },
  WE_ARE_ONE_OF_THE_OPTIONS: {
    meaning: "The customer is judging our proposal against others.",
    example: "Example: we and one other company present.",
  },
  WE_ARE_THE_FAVOURITE: {
    meaning: "The customer prefers us, but has not decided.",
    example: "Example: they ask us to start talking about dates and terms.",
  },
  RECOMMENDATION_TO_BUY: {
    meaning: "The customer's team recommends us to the people who approve.",
    example: "Example: the project lead sends a recommendation to the managing director.",
  },
  DECISION_TO_BUY: {
    meaning: "The people who approve say yes.",
    example: "Example: the managing director approves the purchase.",
  },
  WORK_ORDER_RECEIVED: {
    meaning: "The customer has sent the work order.",
    example: "Example: the signed work order arrives.",
  },
}

/**
 * The one line the Update stage dialog shows when picking one stage moved the
 * other (spec 2026-11-05). `moved` says which stage moved. `label` is the name
 * of the stage it moved to.
 */
export function moveNote(moved: "work" | "sales" | null, label: string): string | null {
  if (moved === null) return null
  return `${moved === "sales" ? "Sales" : "Work"} stage moved to "${label}".`
}
