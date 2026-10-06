import assert from "node:assert/strict"
import test from "node:test"

import { paymentMethodLabel, RECEIPT_PAYMENT_METHODS } from "./receipt-method"

test("each payment method has a plain label", () => {
  assert.equal(paymentMethodLabel("CASH"), "Cash")
  assert.equal(paymentMethodLabel("BANK_TRANSFER"), "Bank transfer")
  assert.equal(paymentMethodLabel("CHEQUE"), "Cheque")
  assert.equal(paymentMethodLabel("MOBILE_BANKING"), "Mobile banking")
})

test("an old receipt with no method says Not recorded", () => {
  assert.equal(paymentMethodLabel(null), "Not recorded")
})

test("the list matches what the server accepts, in the order Finance sees it", () => {
  assert.deepEqual([...RECEIPT_PAYMENT_METHODS], ["CASH", "BANK_TRANSFER", "CHEQUE", "MOBILE_BANKING"])
})

test("no label uses an em-dash", () => {
  for (const method of [...RECEIPT_PAYMENT_METHODS, null] as const) {
    assert.ok(!paymentMethodLabel(method).includes("—"))
  }
})
