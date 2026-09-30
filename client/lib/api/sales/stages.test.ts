import assert from "node:assert/strict"
import test from "node:test"

import { NETWORKING_STAGES, SOFTWARE_STAGES, stagesFor } from "./stages"

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
