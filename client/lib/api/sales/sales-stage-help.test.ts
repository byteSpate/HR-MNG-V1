import assert from "node:assert/strict"
import test from "node:test"

import { NETWORKING_SALES_STAGES, SOFTWARE_SALES_STAGES } from "./sales-stages"
import { SALES_STAGE_HELP, SALES_STAGE_LABEL } from "./sales-stage-help"

const ALL = [...new Set([...NETWORKING_SALES_STAGES, ...SOFTWARE_SALES_STAGES])]

test("every sales stage has a name, a meaning and an example", () => {
  assert.equal(ALL.length, 19)
  for (const stage of ALL) {
    assert.ok(SALES_STAGE_LABEL[stage]?.trim(), `${stage} has no label`)
    assert.ok(SALES_STAGE_HELP[stage]?.meaning.trim(), `${stage} has no meaning`)
    assert.ok(SALES_STAGE_HELP[stage]?.example.trim(), `${stage} has no example`)
  }
})

test("Networking names are management's, exactly as written", () => {
  assert.deepEqual(NETWORKING_SALES_STAGES.map((s) => SALES_STAGE_LABEL[s]), [
    "Pending Initial Meeting", "Awareness", "Research and Internal Education",
    "Budget and Timing Determination", "Project Funded and Kicked-Off",
    "Solution - Shared Competitive Position", "Solution - Front Runner",
    "Recommendation to Fund F5 Purchase", "Decision to Fund F5 Purchase", "PO Received by VAR",
  ])
})

test("Software names are the proposal", () => {
  assert.deepEqual(SOFTWARE_SALES_STAGES.map((s) => SALES_STAGE_LABEL[s]), [
    "Pending Initial Meeting", "Need Understood", "Customer Is Comparing Options",
    "Budget and Timing Known", "Project Funded and Scope Agreed", "We Are One of the Options",
    "We Are the Favourite", "Recommendation to Buy", "Decision to Buy", "Work Order Received",
  ])
})

test("no help text uses an em-dash, and every example starts with Example", () => {
  for (const stage of ALL) {
    const { meaning, example } = SALES_STAGE_HELP[stage]
    for (const text of [SALES_STAGE_LABEL[stage], meaning, example]) assert.ok(!text.includes("—"), `${stage}: em-dash`)
    assert.ok(example.startsWith("Example: "), `${stage}: example should start with "Example: "`)
  }
})

import { moveNote } from "./sales-stage-help"

test("moveNote tells the user which stage moved, in one sentence", () => {
  assert.equal(moveNote("sales", "Recommendation to Fund F5 Purchase"), 'Sales stage moved to "Recommendation to Fund F5 Purchase".')
  assert.equal(moveNote("work", "Commercial Proposal & Negotiation"), 'Work stage moved to "Commercial Proposal & Negotiation".')
  assert.equal(moveNote(null, "x"), null)
})
