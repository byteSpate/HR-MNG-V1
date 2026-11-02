import assert from "node:assert/strict"
import test from "node:test"

import { nextPerson } from "./funnel-nav"

const rows = [{ employeeId: "a" }, { employeeId: "b" }, { employeeId: "c" }]

test("nextPerson gives the next row on the team list", () => {
  assert.equal(nextPerson(rows, "a"), "b")
  assert.equal(nextPerson(rows, "b"), "c")
})

test("nextPerson gives null at the end of the list", () => {
  assert.equal(nextPerson(rows, "c"), null)
})

test("nextPerson gives null for a person who is not on the list, or an empty list", () => {
  assert.equal(nextPerson(rows, "z"), null)
  assert.equal(nextPerson([], "a"), null)
})
