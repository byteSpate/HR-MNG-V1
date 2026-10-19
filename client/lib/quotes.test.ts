import assert from "node:assert/strict"
import test from "node:test"

import { longDay, quoteBodyOf, quoteTitle } from "./quotes"

test("a quote's title counts up from the oldest", () => {
  assert.equal(quoteTitle(0, 3), "Quote 3")
  assert.equal(quoteTitle(2, 3), "Quote 1")
})

test("a date reads as day, month and year, without time zones moving it", () => {
  assert.equal(longDay("2026-10-08"), "8 Oct 2026")
})

test("the form sends trimmed values, or says what to fix", () => {
  assert.deepEqual(quoteBodyOf({ amount: "12,00,000", quotedOn: "2026-10-08", reference: " BS-Q-1 ", note: "" }, "2026-10-13"), {
    body: { amount: "1200000", quotedOn: "2026-10-08", reference: "BS-Q-1", note: null },
  })
  assert.deepEqual(quoteBodyOf({ amount: "", quotedOn: "2026-10-08", reference: "", note: "" }, "2026-10-13"), {
    error: "Write the quote amount.",
  })
  assert.deepEqual(quoteBodyOf({ amount: "12.345", quotedOn: "2026-10-08", reference: "", note: "" }, "2026-10-13"), {
    error: "Write the amount as a number, like 1200000 or 1200000.50.",
  })
  assert.deepEqual(quoteBodyOf({ amount: "5", quotedOn: "", reference: "", note: "" }, "2026-10-13"), {
    error: "Pick the quote date.",
  })
  assert.deepEqual(quoteBodyOf({ amount: "5", quotedOn: "2026-10-14", reference: "", note: "" }, "2026-10-13"), {
    error: "A quote date cannot be in the future.",
  })
})
