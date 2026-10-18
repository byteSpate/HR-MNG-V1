import assert from "node:assert/strict"
import test from "node:test"

import { percentText, STATUS_WORD } from "./payments"

test("the percent paid reads plainly, and a dash when there is no total", () => {
  assert.equal(percentText(null), "-")
  assert.equal(percentText(40), "40%")
  assert.equal(percentText(33.3), "33.3%")
  assert.equal(percentText(100), "100%")
})

test("each status has easy words", () => {
  assert.deepEqual(STATUS_WORD, { PAID: "Paid", PART_PAID: "Part paid", UNPAID: "Unpaid", OVERDUE: "Overdue" })
})
