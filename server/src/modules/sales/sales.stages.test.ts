import { describe, expect, it } from "vitest"
import {
  BEFORE_QUOTE_STAGES, firstStageFor, NETWORKING_STAGES, QUOTED_STAGES, SOFTWARE_STAGES, stageFitsTrack, stagesFor, quoteAskFor, REVISION_STAGES,
  NETWORKING_SALES_STAGES, SOFTWARE_SALES_STAGES, salesStagesFor, salesStageFitsTrack, lastSalesStageFor,
  salesStageFitsWork, PAIR_REFUSAL, WRONG_TRACK_SALES_STAGE,
} from "./sales.stages"
import type { OpportunityStage, SalesTrack } from "../../generated/prisma/client"

describe("stages per track", () => {
  it("gives Networking its six stages in order", () => {
    expect(NETWORKING_STAGES).toEqual([
      "ASSIGNED_QUALIFIED", "DISCOVERY_DESIGN", "TECHNICAL_VALIDATION",
      "COMMERCIAL_NEGOTIATION", "CUSTOMER_PROCUREMENT", "PO_RECEIVED",
    ])
  })

  it("gives Software its eight stages in order", () => {
    expect(SOFTWARE_STAGES).toEqual([
      "REQUIREMENT_RECEIVED", "REQUIREMENT_GATHERING", "BRD_SENT", "SRS_SENT",
      "PROPOSAL_SUBMITTED", "PROPOSAL_REVISION", "NEGOTIATION", "AWAITING_DECISION",
    ])
    expect(stagesFor("SOFTWARE_DEVELOPMENT")).toBe(SOFTWARE_STAGES)
    expect(stagesFor("NETWORKING")).toBe(NETWORKING_STAGES)
  })

  it("starts each track at its own first stage", () => {
    expect(firstStageFor("NETWORKING")).toBe("ASSIGNED_QUALIFIED")
    expect(firstStageFor("SOFTWARE_DEVELOPMENT")).toBe("REQUIREMENT_RECEIVED")
  })

  it("says which stage fits which track", () => {
    expect(stageFitsTrack("BRD_SENT", "NETWORKING")).toBe(false)
    expect(stageFitsTrack("DISCOVERY_DESIGN", "SOFTWARE_DEVELOPMENT")).toBe(false)
    // The old Networking first stage now belongs to Software only.
    expect(stageFitsTrack("REQUIREMENT_RECEIVED", "NETWORKING")).toBe(false)
    expect(stageFitsTrack("NEGOTIATION", "SOFTWARE_DEVELOPMENT")).toBe(true)
    expect(stageFitsTrack("PO_RECEIVED", "NETWORKING")).toBe(true)
  })

  it("puts a Networking Opportunity in the funnel from stage 4, and a Software one from Proposal submitted", () => {
    for (const stage of ["COMMERCIAL_NEGOTIATION", "CUSTOMER_PROCUREMENT", "PO_RECEIVED"]) {
      expect(QUOTED_STAGES.has(stage)).toBe(true)
    }
    for (const stage of ["ASSIGNED_QUALIFIED", "DISCOVERY_DESIGN", "TECHNICAL_VALIDATION"]) {
      expect(QUOTED_STAGES.has(stage)).toBe(false)
    }
    expect(QUOTED_STAGES.has("PROPOSAL_SUBMITTED")).toBe(true)
    expect(QUOTED_STAGES.has("PROPOSAL_REVISION")).toBe(true)
    expect(QUOTED_STAGES.has("SRS_SENT")).toBe(false)
  })
})

describe("when the stage change asks for a quote (owner, 2026-10-13)", () => {
  it("requires Quote 1 on the first move into a quote stage", () => {
    expect(quoteAskFor("COMMERCIAL_NEGOTIATION", { offeredOn: null })).toBe("REQUIRED")
    expect(quoteAskFor("PO_RECEIVED", { offeredOn: null })).toBe("REQUIRED")
    expect(quoteAskFor("PROPOSAL_SUBMITTED", { offeredOn: null })).toBe("REQUIRED")
  })

  it("offers a new quote on the revision stages once on the Funnel", () => {
    expect(quoteAskFor("PROPOSAL_REVISION", { offeredOn: new Date() })).toBe("OPTIONAL")
    expect(quoteAskFor("NEGOTIATION", { offeredOn: "2026-10-01" })).toBe("OPTIONAL")
    expect(REVISION_STAGES.has("NEGOTIATION")).toBe(true)
  })

  it("asks nothing before the quote stages, or on other quote stages once on the Funnel", () => {
    expect(quoteAskFor("TECHNICAL_VALIDATION", { offeredOn: null })).toBeNull()
    expect(quoteAskFor("CUSTOMER_PROCUREMENT", { offeredOn: new Date() })).toBeNull()
  })
})

describe("the stages before the first quote (owner, 2026-11-02)", () => {
  it("is 3 stages for Networking and 4 for Software", () => {
    expect(BEFORE_QUOTE_STAGES.NETWORKING).toEqual(["ASSIGNED_QUALIFIED", "DISCOVERY_DESIGN", "TECHNICAL_VALIDATION"])
    expect(BEFORE_QUOTE_STAGES.SOFTWARE_DEVELOPMENT).toEqual([
      "REQUIREMENT_RECEIVED", "REQUIREMENT_GATHERING", "BRD_SENT", "SRS_SENT",
    ])
  })

  it("never holds a stage where an offer has gone out", () => {
    for (const track of ["NETWORKING", "SOFTWARE_DEVELOPMENT"] as const) {
      for (const stage of BEFORE_QUOTE_STAGES[track]) expect(QUOTED_STAGES.has(stage)).toBe(false)
    }
  })

  it("keeps each track's own stage order", () => {
    expect(NETWORKING_STAGES.slice(0, 3)).toEqual(BEFORE_QUOTE_STAGES.NETWORKING)
    expect(SOFTWARE_STAGES.slice(0, 4)).toEqual(BEFORE_QUOTE_STAGES.SOFTWARE_DEVELOPMENT)
  })
})

describe("sales stages (the customer side)", () => {
  it("gives Networking management's ten names in order", () => {
    expect(NETWORKING_SALES_STAGES).toHaveLength(10)
    expect(NETWORKING_SALES_STAGES[0]).toBe("PENDING_INITIAL_MEETING")
    expect(NETWORKING_SALES_STAGES[4]).toBe("PROJECT_FUNDED_AND_KICKED_OFF")
    expect(NETWORKING_SALES_STAGES[9]).toBe("PO_RECEIVED_BY_VAR")
    expect(salesStagesFor("NETWORKING")).toBe(NETWORKING_SALES_STAGES)
  })

  it("gives Software its own ten, sharing only the first", () => {
    expect(SOFTWARE_SALES_STAGES).toHaveLength(10)
    expect(SOFTWARE_SALES_STAGES[0]).toBe("PENDING_INITIAL_MEETING")
    expect(SOFTWARE_SALES_STAGES[9]).toBe("WORK_ORDER_RECEIVED")
    expect(salesStagesFor("SOFTWARE_DEVELOPMENT")).toBe(SOFTWARE_SALES_STAGES)
    const shared = NETWORKING_SALES_STAGES.filter((s) => SOFTWARE_SALES_STAGES.includes(s))
    expect(shared).toEqual(["PENDING_INITIAL_MEETING"])
  })

  it("says which sales stage fits which track", () => {
    expect(salesStageFitsTrack("NEED_UNDERSTOOD", "NETWORKING")).toBe(false)
    expect(salesStageFitsTrack("AWARENESS", "SOFTWARE_DEVELOPMENT")).toBe(false)
    expect(salesStageFitsTrack("PENDING_INITIAL_MEETING", "SOFTWARE_DEVELOPMENT")).toBe(true)
    expect(salesStageFitsTrack("PENDING_INITIAL_MEETING", "NETWORKING")).toBe(true)
  })

  it("names the last stage of each track (used when an Opportunity is Won)", () => {
    expect(lastSalesStageFor("NETWORKING")).toBe("PO_RECEIVED_BY_VAR")
    expect(lastSalesStageFor("SOFTWARE_DEVELOPMENT")).toBe("WORK_ORDER_RECEIVED")
  })

  it("refuses with plain words and no em-dash", () => {
    expect(PAIR_REFUSAL).not.toContain("—")
    expect(PAIR_REFUSAL).toMatch(/do not fit/)
    expect(WRONG_TRACK_SALES_STAGE.NETWORKING).not.toContain("—")
    expect(WRONG_TRACK_SALES_STAGE.SOFTWARE_DEVELOPMENT).not.toContain("—")
  })
})

// The spec's rule table, written out again here on purpose: a typo in the
// source table fails against this copy.
const RULES: Record<SalesTrack, [OpportunityStage, number, number][]> = {
  NETWORKING: [
    ["ASSIGNED_QUALIFIED", 1, 4], ["DISCOVERY_DESIGN", 2, 5], ["TECHNICAL_VALIDATION", 2, 7],
    ["COMMERCIAL_NEGOTIATION", 5, 9], ["CUSTOMER_PROCUREMENT", 8, 9], ["PO_RECEIVED", 10, 10],
  ],
  SOFTWARE_DEVELOPMENT: [
    ["REQUIREMENT_RECEIVED", 1, 4], ["REQUIREMENT_GATHERING", 2, 4], ["BRD_SENT", 2, 7], ["SRS_SENT", 2, 7],
    ["PROPOSAL_SUBMITTED", 2, 9], ["PROPOSAL_REVISION", 5, 9], ["NEGOTIATION", 5, 9], ["AWAITING_DECISION", 5, 9],
  ],
}

describe("which sales stages a work stage allows", () => {
  for (const track of ["NETWORKING", "SOFTWARE_DEVELOPMENT"] as const) {
    for (const [work, min, max] of RULES[track]) {
      it(`${track} ${work} allows sales stages ${min} to ${max} only`, () => {
        salesStagesFor(track).forEach((sales, index) => {
          const number = index + 1
          expect(salesStageFitsWork(track, work, sales), `${work} with sales stage ${number}`).toBe(number >= min && number <= max)
        })
      })
    }
  }

  it("refuses a sales stage of the other track", () => {
    expect(salesStageFitsWork("NETWORKING", "DISCOVERY_DESIGN", "NEED_UNDERSTOOD")).toBe(false)
  })

  it("covers every work stage of both tracks", () => {
    expect(RULES.NETWORKING.map((r) => r[0])).toEqual([...NETWORKING_STAGES])
    expect(RULES.SOFTWARE_DEVELOPMENT.map((r) => r[0])).toEqual([...SOFTWARE_STAGES])
  })
})
