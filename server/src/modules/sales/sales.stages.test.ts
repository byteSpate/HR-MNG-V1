import { describe, expect, it } from "vitest"
import {
  firstStageFor, NETWORKING_STAGES, QUOTED_STAGES, SOFTWARE_STAGES, stageFitsTrack, stagesFor,
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
