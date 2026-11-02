import { describe, expect, it } from "vitest"
import {
  BEFORE_QUOTE_STAGES, firstStageFor, NETWORKING_STAGES, QUOTED_STAGES, SOFTWARE_STAGES, stageFitsTrack, stagesFor, quoteAskFor, REVISION_STAGES,
} from "./sales.stages"

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
