import assert from "node:assert/strict"
import test from "node:test"

import { TASK_TYPE_LABEL, TASK_TYPES } from "./task-types"

test("the types come in the same order as the server enum", () => {
  assert.deepEqual(TASK_TYPES, [
    "VISIT_FOLLOW_UP", "QUOTATION_SENT", "REQUIREMENT_SENT", "CALL_OR_EMAIL", "LEARNING", "INTERNAL_WORK", "OTHER",
  ])
})

test("every type has an easy label", () => {
  assert.deepEqual(TASK_TYPES.map((type) => TASK_TYPE_LABEL[type]), [
    "Visit follow-up", "Quotation sent", "Requirement sent", "Call or email", "Learning", "Internal work", "Other",
  ])
})

test("no label has an em-dash, and each label is short", () => {
  for (const type of TASK_TYPES) {
    assert.equal(TASK_TYPE_LABEL[type].includes("—"), false)
    assert.ok(TASK_TYPE_LABEL[type].length <= 20)
  }
})
