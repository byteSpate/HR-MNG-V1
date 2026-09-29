import { describe, expect, it } from "vitest"
import { NETWORKING_STAGES, QUOTED_STAGES, SOFTWARE_STAGES, stageFitsTrack, stagesFor } from "./sales.stages"

describe("stages per track", () => {
  it("keeps the six Networking stages as they are", () => {
    expect(NETWORKING_STAGES).toEqual([
      "REQUIREMENT_RECEIVED", "SOLUTION_DESIGN", "OEM_PRICING", "QUOTATION_SUBMITTED", "NEGOTIATION", "AWAITING_DECISION",
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

  it("says which stage fits which track", () => {
    expect(stageFitsTrack("BRD_SENT", "NETWORKING")).toBe(false)
    expect(stageFitsTrack("OEM_PRICING", "SOFTWARE_DEVELOPMENT")).toBe(false)
    expect(stageFitsTrack("NEGOTIATION", "SOFTWARE_DEVELOPMENT")).toBe(true)
  })

  it("puts a Software Opportunity in the funnel from Proposal Submitted", () => {
    expect(QUOTED_STAGES.has("PROPOSAL_SUBMITTED")).toBe(true)
    expect(QUOTED_STAGES.has("PROPOSAL_REVISION")).toBe(true)
    expect(QUOTED_STAGES.has("SRS_SENT")).toBe(false)
    expect(QUOTED_STAGES.has("QUOTATION_SUBMITTED")).toBe(true)
  })
})
