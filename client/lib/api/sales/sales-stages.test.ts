import assert from "node:assert/strict"
import test from "node:test"

import type { OpportunityStage, SalesTrack } from "../types"
import { NETWORKING_STAGES, SOFTWARE_STAGES } from "./stages"
import {
  fitsPair, nearestSalesStage, nearestWorkStage, nextWorkStage, NETWORKING_SALES_STAGES, pickPair,
  SOFTWARE_SALES_STAGES, salesStagesFor,
} from "./sales-stages"

// The spec's rule table, written out again here on purpose. The server has its
// own copy and its own test. A typo in either copy fails against this one.
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

test("each track has ten sales stages, and the two lists share only the first", () => {
  assert.equal(NETWORKING_SALES_STAGES.length, 10)
  assert.equal(SOFTWARE_SALES_STAGES.length, 10)
  assert.equal(salesStagesFor("NETWORKING"), NETWORKING_SALES_STAGES)
  assert.equal(salesStagesFor("SOFTWARE_DEVELOPMENT"), SOFTWARE_SALES_STAGES)
  assert.deepEqual(NETWORKING_SALES_STAGES.filter((s) => SOFTWARE_SALES_STAGES.includes(s)), ["PENDING_INITIAL_MEETING"])
  assert.equal(NETWORKING_SALES_STAGES[9], "PURCHASE_ORDER_RECEIVED")
  assert.equal(SOFTWARE_SALES_STAGES[9], "WORK_ORDER_RECEIVED")
})

test("the rule table covers every work stage of both tracks", () => {
  assert.deepEqual(RULES.NETWORKING.map((r) => r[0]), NETWORKING_STAGES)
  assert.deepEqual(RULES.SOFTWARE_DEVELOPMENT.map((r) => r[0]), SOFTWARE_STAGES)
})

for (const track of ["NETWORKING", "SOFTWARE_DEVELOPMENT"] as const) {
  for (const [work, min, max] of RULES[track]) {
    test(`${track} ${work} allows sales stages ${min} to ${max} only`, () => {
      salesStagesFor(track).forEach((sales, index) => {
        const number = index + 1
        assert.equal(fitsPair(track, work, sales), number >= min && number <= max, `${work} with sales stage ${number}`)
      })
    })
  }
}

test("a sales stage of the other track never fits", () => {
  assert.equal(fitsPair("NETWORKING", "DISCOVERY_DESIGN", "NEED_UNDERSTOOD"), false)
})

test("nearestSalesStage clamps to the nearest allowed stage", () => {
  assert.equal(nearestSalesStage("NETWORKING", "CUSTOMER_PROCUREMENT", "AWARENESS"), "RECOMMENDATION_TO_FUND")
  assert.equal(nearestSalesStage("NETWORKING", "ASSIGNED_QUALIFIED", "DECISION_TO_FUND"), "BUDGET_AND_TIMING_DETERMINATION")
  assert.equal(nearestSalesStage("NETWORKING", "TECHNICAL_VALIDATION", "AWARENESS"), "AWARENESS")
})

test("nearestWorkStage picks the allowed work stage closest to the current one, the earlier on a tie", () => {
  assert.equal(nearestWorkStage("NETWORKING", "DISCOVERY_DESIGN", "DECISION_TO_FUND"), "COMMERCIAL_NEGOTIATION")
  assert.equal(nearestWorkStage("NETWORKING", "CUSTOMER_PROCUREMENT", "AWARENESS"), "TECHNICAL_VALIDATION")
  assert.equal(nearestWorkStage("NETWORKING", "TECHNICAL_VALIDATION", "AWARENESS"), "TECHNICAL_VALIDATION")
})

test("pickPair: the other stage stays when it still fits", () => {
  const result = pickPair("NETWORKING", { work: "DISCOVERY_DESIGN", sales: "AWARENESS" }, { work: "TECHNICAL_VALIDATION" })
  assert.deepEqual(result, { work: "TECHNICAL_VALIDATION", sales: "AWARENESS", moved: null })
})

test("pickPair: the sales stage moves when the new work stage does not allow it, and says so", () => {
  const result = pickPair("NETWORKING", { work: "DISCOVERY_DESIGN", sales: "AWARENESS" }, { work: "CUSTOMER_PROCUREMENT" })
  assert.deepEqual(result, { work: "CUSTOMER_PROCUREMENT", sales: "RECOMMENDATION_TO_FUND", moved: "sales" })
})

test("pickPair: the work stage moves when the new sales stage does not fit it, and says so", () => {
  const result = pickPair("NETWORKING", { work: "DISCOVERY_DESIGN", sales: "AWARENESS" }, { sales: "DECISION_TO_FUND" })
  assert.deepEqual(result, { work: "COMMERCIAL_NEGOTIATION", sales: "DECISION_TO_FUND", moved: "work" })
})

test("pickPair: an Opportunity with no sales stage keeps none when the work stage moves", () => {
  for (const work of NETWORKING_STAGES) {
    const result = pickPair("NETWORKING", { work: "ASSIGNED_QUALIFIED", sales: null }, { work })
    assert.deepEqual(result, { work, sales: null, moved: null })
  }
})

test("pickPair: picking a sales stage on an Opportunity with none still works", () => {
  const result = pickPair("SOFTWARE_DEVELOPMENT", { work: "BRD_SENT", sales: null }, { sales: "NEED_UNDERSTOOD" })
  assert.deepEqual(result, { work: "BRD_SENT", sales: "NEED_UNDERSTOOD", moved: null })
})

test("nextWorkStage is the next stage of the track, and null at the end", () => {
  assert.equal(nextWorkStage("SOFTWARE_DEVELOPMENT", "BRD_SENT"), "SRS_SENT")
  assert.equal(nextWorkStage("NETWORKING", "ASSIGNED_QUALIFIED"), "DISCOVERY_DESIGN")
  assert.equal(nextWorkStage("NETWORKING", "PO_RECEIVED"), null)
  assert.equal(nextWorkStage("SOFTWARE_DEVELOPMENT", "AWAITING_DECISION"), null)
})
