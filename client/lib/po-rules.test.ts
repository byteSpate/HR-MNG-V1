import assert from "node:assert/strict"
import test from "node:test"

import { canRecordPo, linesToBill } from "./po-rules"

const line = (id: string, amount: string, invoiced: string[] = []) => ({
  id,
  description: `Line ${id}`,
  amount,
  invoiceLines: invoiced.map((a) => ({ amount: a })),
})

test("an Opportunity with no PO can record one", () => {
  assert.equal(canRecordPo([]), true)
})

test("an open or a complete PO means no second PO", () => {
  assert.equal(canRecordPo([{ status: "OPEN" }]), false)
  assert.equal(canRecordPo([{ status: "COMPLETE" }]), false)
})

test("a cancelled PO does not count, so a new one can be recorded", () => {
  assert.equal(canRecordPo([{ status: "CANCELLED" }]), true)
})

test("a cancelled PO beside a live one still means no second PO", () => {
  assert.equal(canRecordPo([{ status: "CANCELLED" }, { status: "OPEN" }]), false)
})

test("a new PO is billed line by line, in full", () => {
  assert.deepEqual(linesToBill({ lines: [line("a", "800000.00"), line("b", "100000.00")] }), [
    { poLineId: "a", description: "Line a", amount: "800000.00" },
    { poLineId: "b", description: "Line b", amount: "100000.00" },
  ])
})

test("an older PO that was part billed gets one invoice for all that is left", () => {
  assert.deepEqual(linesToBill({ lines: [line("a", "800000.00", ["300000.00"]), line("b", "100000.00")] }), [
    { poLineId: "a", description: "Line a", amount: "500000.00" },
    { poLineId: "b", description: "Line b", amount: "100000.00" },
  ])
})

test("a line that is fully billed is left out", () => {
  assert.deepEqual(linesToBill({ lines: [line("a", "800000.00", ["800000.00"]), line("b", "100000.00")] }), [
    { poLineId: "b", description: "Line b", amount: "100000.00" },
  ])
})

test("adds money exactly, with no floating point drift", () => {
  assert.deepEqual(linesToBill({ lines: [line("a", "0.30", ["0.10", "0.20"])] }), [])
  assert.deepEqual(linesToBill({ lines: [line("a", "0.30", ["0.10"])] }), [
    { poLineId: "a", description: "Line a", amount: "0.20" },
  ])
})

test("a PO with nothing left gives no lines", () => {
  assert.deepEqual(linesToBill({ lines: [line("a", "100.00", ["100.00"])] }), [])
})
