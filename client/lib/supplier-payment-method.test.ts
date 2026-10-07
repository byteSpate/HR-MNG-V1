import assert from "node:assert/strict"
import test from "node:test"

import { SUPPLIER_PAYMENT_METHODS, supplierMethodLabel } from "./supplier-payment-method"

test("each payment method has a plain label", () => {
  assert.equal(supplierMethodLabel("BANK_TRANSFER"), "Bank transfer")
  assert.equal(supplierMethodLabel("CHEQUE"), "Cheque")
  assert.equal(supplierMethodLabel("MOBILE_BANKING"), "Mobile banking")
})

test("an old payment with no method says Not recorded", () => {
  assert.equal(supplierMethodLabel(null), "Not recorded")
})

test("the list matches what the server accepts, in the order Finance sees it, and has no Cash", () => {
  assert.deepEqual([...SUPPLIER_PAYMENT_METHODS], ["BANK_TRANSFER", "CHEQUE", "MOBILE_BANKING"])
})

test("no label uses an em-dash", () => {
  for (const method of [...SUPPLIER_PAYMENT_METHODS, null] as const) {
    assert.ok(!supplierMethodLabel(method).includes("—"))
  }
})
