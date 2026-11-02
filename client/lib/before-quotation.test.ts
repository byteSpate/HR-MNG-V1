import assert from "node:assert/strict"
import test from "node:test"

import { daysInStage, nextStepParts, quoteDueState, QUOTE_DUE_DAYS } from "./before-quotation"

test("daysInStage counts whole days, never a part of a day", () => {
  const now = new Date("2026-11-10T10:00:00.000Z")
  assert.equal(daysInStage("2026-11-10T08:00:00.000Z", now), 0)
  assert.equal(daysInStage("2026-11-09T11:00:00.000Z", now), 0)
  assert.equal(daysInStage("2026-11-09T10:00:00.000Z", now), 1)
  assert.equal(daysInStage("2026-10-11T10:00:00.000Z", now), 30)
})

test("daysInStage is zero, not negative, for a stage change that looks like it is in the future", () => {
  assert.equal(daysInStage("2026-11-12T10:00:00.000Z", new Date("2026-11-10T10:00:00.000Z")), 0)
})

test("nextStepParts says there is no next step when the text is empty", () => {
  assert.deepEqual(nextStepParts({ nextStep: null, nextStepDueOn: null }), { text: null, dueOn: null })
  assert.deepEqual(nextStepParts({ nextStep: "   ", nextStepDueOn: "2026-11-20" }), { text: null, dueOn: null })
})

test("nextStepParts gives the text and its day", () => {
  assert.deepEqual(nextStepParts({ nextStep: " Send the BRD ", nextStepDueOn: "2026-11-20" }), { text: "Send the BRD", dueOn: "2026-11-20" })
  assert.deepEqual(nextStepParts({ nextStep: "Call the CTO", nextStepDueOn: null }), { text: "Call the CTO", dueOn: null })
})

test("quoteDueState is none when no date is set", () => {
  assert.equal(quoteDueState(null, "2026-11-10"), "none")
})

test("quoteDueState is late for a day that has passed", () => {
  assert.equal(quoteDueState("2026-11-09", "2026-11-10"), "late")
})

test("quoteDueState is soon from today up to the due-soon days, and later after that", () => {
  assert.equal(QUOTE_DUE_DAYS, 14)
  assert.equal(quoteDueState("2026-11-10", "2026-11-10"), "soon")
  assert.equal(quoteDueState("2026-11-24", "2026-11-10"), "soon")
  assert.equal(quoteDueState("2026-11-25", "2026-11-10"), "later")
})
