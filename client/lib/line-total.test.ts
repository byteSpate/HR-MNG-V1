import assert from "node:assert/strict"
import test from "node:test"

import { lineQuantity, lineTotal } from "./line-total"

test("the Total is Quantity × Price per unit, to 2 decimals", () => {
  assert.equal(lineTotal("3", "1000.50"), 3001.5)
  assert.equal(lineTotal("2", "0.335"), 0.67)
})

test("there is no Total until both are typed, never 0", () => {
  assert.equal(lineTotal("", "10"), null)
  assert.equal(lineTotal("2", ""), null)
  assert.equal(lineTotal("two", "10"), null)
})

test("a Software module never sends a quantity, so the server does not refuse it", () => {
  assert.equal(lineQuantity(true, "1"), undefined)
  assert.equal(lineQuantity(false, "3"), 3)
  assert.equal(lineQuantity(false, ""), null)
})
