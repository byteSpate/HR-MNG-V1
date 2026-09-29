import assert from "node:assert/strict"
import test from "node:test"

import { vatFieldsFor } from "./vat-payload"

const line = { vatCodeId: "code-1", vatMethod: "CODE" as const, vatRatePercent: "" }

test("a VAT code line sends no typed rate, even if the box still holds one", () => {
  // Changing a typed line back to a code leaves the old text in state.
  assert.deepEqual(vatFieldsFor({ ...line, vatRatePercent: "7.5" }), { vatCodeId: "code-1", vatMethod: "CODE" })
  assert.deepEqual(vatFieldsFor(line), { vatCodeId: "code-1", vatMethod: "CODE" })
})

test("a typed line sends its rate", () => {
  assert.deepEqual(vatFieldsFor({ ...line, vatMethod: "MANUAL", vatRatePercent: "7.5" }), {
    vatCodeId: "code-1", vatMethod: "MANUAL", vatRatePercent: "7.5",
  })
})
