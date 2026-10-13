import assert from "node:assert/strict"
import test from "node:test"

import type { HeatmapProductView } from "./api/types"
import { closedLine, COLOUR, COLOUR_ORDER } from "./heatmap"

const product = (o: Partial<HeatmapProductView> = {}): HeatmapProductView => ({
  id: "p", title: "Router", colour: "GREY", reason: null, pickedByName: null, pickedAt: null,
  parts: [
    { id: "a", title: "Small", note: null, inScope: true },
    { id: "b", title: "Mid", note: null, inScope: true },
    { id: "c", title: "High", note: null, inScope: false },
  ],
  inScopeCount: 2, ...o,
})

test("there are three colours and no Yellow", () => {
  assert.deepEqual(COLOUR_ORDER, ["GREEN", "RED", "GREY"])
  assert.equal(COLOUR.GREEN.word, "Can sell")
  assert.equal(COLOUR.RED.word, "No chance")
  assert.equal(COLOUR.GREY.word, "Not picked")
})

test("a closed row says how many parts are in scope", () => {
  assert.equal(closedLine(product()), "2 of 3 in scope")
  assert.equal(closedLine(product({ inScopeCount: 0 })), "Nothing in scope yet")
})

test("a Red row shows its reason instead", () => {
  assert.equal(closedLine(product({ colour: "RED", reason: "Uses another vendor" })), "No need: Uses another vendor")
})

test("a product with no parts says nothing about scope", () => {
  assert.equal(closedLine(product({ parts: [], inScopeCount: 0 })), "")
})
