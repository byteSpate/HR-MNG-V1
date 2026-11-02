import assert from "node:assert/strict"
import test from "node:test"

import { cleanNextSteps, defaultNextStepDue, FOLLOW_UP_DAYS } from "./next-steps"

test("cleanNextSteps drops blank lines and trims the rest, keeping their order", () => {
  const lines = [
    { title: "  Send the revised quote ", dueOn: "2026-11-17" },
    { title: "   ", dueOn: "2026-11-17" },
    { title: "", dueOn: "2026-11-18" },
    { title: "Book the site survey", dueOn: "2026-11-20" },
  ]
  assert.deepEqual(cleanNextSteps(lines), [
    { title: "Send the revised quote", dueOn: "2026-11-17" },
    { title: "Book the site survey", dueOn: "2026-11-20" },
  ])
})

test("cleanNextSteps gives an empty list when every line is blank", () => {
  assert.deepEqual(cleanNextSteps([{ title: " ", dueOn: "2026-11-17" }]), [])
  assert.deepEqual(cleanNextSteps([]), [])
})

test("defaultNextStepDue adds the house follow-up days to today", () => {
  assert.equal(FOLLOW_UP_DAYS, 15)
  assert.equal(defaultNextStepDue("2026-11-02"), "2026-11-17")
})

test("defaultNextStepDue carries over a month and a year end", () => {
  assert.equal(defaultNextStepDue("2026-11-20"), "2026-12-05")
  assert.equal(defaultNextStepDue("2026-12-25"), "2027-01-09")
})
