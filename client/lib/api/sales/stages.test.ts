import assert from "node:assert/strict"
import test from "node:test"

import { BEFORE_QUOTE_STAGES, NETWORKING_STAGES, QUOTED_STAGES, quoteAskFor, SOFTWARE_STAGES, STAGE_LINK_FIELDS, stagesFor } from "./stages"

test("Networking has the six stages, in order", () => {
  assert.deepEqual(NETWORKING_STAGES, [
    "ASSIGNED_QUALIFIED", "DISCOVERY_DESIGN", "TECHNICAL_VALIDATION",
    "COMMERCIAL_NEGOTIATION", "CUSTOMER_PROCUREMENT", "PO_RECEIVED",
  ])
})

test("Software keeps its eight stages", () => {
  assert.deepEqual(SOFTWARE_STAGES, [
    "REQUIREMENT_RECEIVED", "REQUIREMENT_GATHERING", "BRD_SENT", "SRS_SENT",
    "PROPOSAL_SUBMITTED", "PROPOSAL_REVISION", "NEGOTIATION", "AWAITING_DECISION",
  ])
})

test("each track offers its own stages", () => {
  assert.equal(stagesFor("NETWORKING"), NETWORKING_STAGES)
  assert.equal(stagesFor("SOFTWARE_DEVELOPMENT"), SOFTWARE_STAGES)
})

test("six stages ask for a link, in easy words", () => {
  assert.deepEqual(Object.keys(STAGE_LINK_FIELDS).sort(), [
    "BRD_SENT", "COMMERCIAL_NEGOTIATION", "DISCOVERY_DESIGN", "REQUIREMENT_RECEIVED", "SRS_SENT", "TECHNICAL_VALIDATION",
  ])
  const expected: Record<string, [string, string, string]> = {
    DISCOVERY_DESIGN: ["Design files", "No design file link added yet.", "Design v1"],
    COMMERCIAL_NEGOTIATION: ["Costing and BOQ link", "No costing or BOQ link added yet.", "Costing v1"],
    REQUIREMENT_RECEIVED: ["Requirement document", "No requirement document link added yet.", "Requirement v1"],
    BRD_SENT: ["BRD file", "No BRD link added yet.", "BRD v1"],
    SRS_SENT: ["SRS file", "No SRS link added yet.", "SRS v1"],
    TECHNICAL_VALIDATION: ["Validation report", "No validation report link added yet.", "Validation v1"],
  }
  for (const [stage, [title, empty, placeholder]] of Object.entries(expected)) {
    const box = STAGE_LINK_FIELDS[stage as keyof typeof STAGE_LINK_FIELDS]
    assert.equal(box?.title, title, `${stage} title`)
    assert.equal(box?.empty, empty, `${stage} empty text`)
    assert.equal(box?.namePlaceholder, placeholder, `${stage} name hint`)
  }
  assert.equal(STAGE_LINK_FIELDS.COMMERCIAL_NEGOTIATION?.kind, "COSTING_BOQ")
})

test("only the Commercial box is a costing box, and no new box blocks anything", () => {
  const costing = Object.entries(STAGE_LINK_FIELDS).filter(([, box]) => box?.kind === "COSTING_BOQ")
  assert.deepEqual(costing.map(([stage]) => stage), ["COMMERCIAL_NEGOTIATION"])
})

test("before quotation is 3 stages for Networking and 4 for Software, like the server", () => {
  assert.deepEqual(BEFORE_QUOTE_STAGES.NETWORKING, ["ASSIGNED_QUALIFIED", "DISCOVERY_DESIGN", "TECHNICAL_VALIDATION"])
  assert.deepEqual(BEFORE_QUOTE_STAGES.SOFTWARE_DEVELOPMENT, ["REQUIREMENT_RECEIVED", "REQUIREMENT_GATHERING", "BRD_SENT", "SRS_SENT"])
  for (const track of ["NETWORKING", "SOFTWARE_DEVELOPMENT"] as const) {
    for (const stage of BEFORE_QUOTE_STAGES[track]) assert.equal(QUOTED_STAGES.has(stage), false, `${stage} is before the quote`)
  }
})

test("the first move into a quote stage needs the quote; a revision stage offers one", () => {
  assert.equal(quoteAskFor("COMMERCIAL_NEGOTIATION", { offeredOn: null }), "REQUIRED")
  assert.equal(quoteAskFor("PROPOSAL_SUBMITTED", { offeredOn: null }), "REQUIRED")
  assert.equal(quoteAskFor("NEGOTIATION", { offeredOn: "2026-10-01" }), "OPTIONAL")
  assert.equal(quoteAskFor("CUSTOMER_PROCUREMENT", { offeredOn: "2026-10-01" }), null)
  assert.equal(quoteAskFor("TECHNICAL_VALIDATION", { offeredOn: null }), null)
})
