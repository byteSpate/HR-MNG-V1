import assert from "node:assert/strict"
import test from "node:test"

import { blankToNull, editDate, editText } from "./forms"

test("blankToNull trims and turns an empty box into null", () => {
  assert.equal(blankToNull("  "), null)
  assert.equal(blankToNull(" a "), "a")
})

test("editText: unchanged is left out, cleared is null, changed is the new text", () => {
  assert.equal(editText("old", "old"), undefined)
  assert.equal(editText("  old ", "old"), undefined)
  assert.equal(editText("", "old"), null)
  assert.equal(editText("new", "old"), "new")
})

test("editText: an empty box over an empty value is left out", () => {
  assert.equal(editText("", null), undefined)
  assert.equal(editText("", ""), undefined)
})

test("editDate: unchanged is left out, cleared is null, changed is the new date", () => {
  assert.equal(editDate("2027-01-01", "2027-01-01"), undefined)
  assert.equal(editDate("", "2027-01-01"), null)
  assert.equal(editDate("2028-02-02", "2027-01-01"), "2028-02-02")
  assert.equal(editDate("", ""), undefined)
})
