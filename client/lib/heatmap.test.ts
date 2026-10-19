import assert from "node:assert/strict"
import test from "node:test"

import type { HeatmapGroupView, HeatmapOverviewProduct, HeatmapProductView } from "./api/types"
import { allMarkTarget, barShares, boardLanes, checkedLine, closedLine, COLOUR, COLOUR_ORDER, deleteWarning, nextPartMark, usedByText } from "./heatmap"

const product = (o: Partial<HeatmapProductView> = {}): HeatmapProductView => ({
  id: "p", title: "Router", colour: "GREY", note: null, markedByName: null, markedAt: null,
  parts: [
    { id: "a", title: "Small", note: null, mark: null },
    { id: "b", title: "Mid", note: null, mark: null },
    { id: "c", title: "High", note: null, mark: null },
  ],
  tickedCount: 0, checkedCount: 0, ...o,
})

test("there are three colours and no Yellow, and nobody picks Grey", () => {
  assert.deepEqual(COLOUR_ORDER, ["GREEN", "RED", "GREY"])
  assert.equal(COLOUR.GREEN.word, "Can offer")
  assert.equal(COLOUR.RED.word, "Cannot offer")
  assert.equal(COLOUR.GREY.word, "Not checked")
})

test("a Green product says how many parts are ticked", () => {
  assert.equal(closedLine(product({ colour: "GREEN", tickedCount: 2, checkedCount: 2 })), "2 of 3 parts ticked")
  assert.equal(closedLine(product({ colour: "GREEN", tickedCount: 1, parts: [{ id: "a", title: "Whole product", note: null, mark: "GREEN" }] })), "1 of 1 part ticked")
})

test("a Red product shows its note, or a plain line when it has none", () => {
  assert.equal(closedLine(product({ colour: "RED", note: "Uses another vendor" })), "Uses another vendor")
  assert.equal(closedLine(product({ colour: "RED" })), "They have it, or we cannot go.")
})

test("a Grey product says nothing has been checked, or how far it got", () => {
  assert.equal(closedLine(product()), "Not checked yet")
  assert.equal(closedLine(product({ checkedCount: 2 })), "2 of 3 parts checked")
  assert.equal(closedLine(product({ parts: [] })), "No parts yet")
})

const groups: HeatmapGroupView[] = [
  { id: "g1", title: "Network", products: [product({ id: "1", title: "Router", colour: "GREEN" }), product({ id: "2", title: "Switch", colour: "RED" }), product({ id: "3", title: "Firewall" })] },
  { id: "g2", title: "Servers", products: [product({ id: "4", title: "Server", colour: "GREEN" })] },
]

test("the board has Green on one side, Red on the other, and leaves Grey off", () => {
  const lanes = boardLanes(groups)
  assert.deepEqual(lanes.green.map((c) => c.product.id), ["1", "4"])
  assert.deepEqual(lanes.red.map((c) => c.product.id), ["2"])
  assert.deepEqual(lanes.green.map((c) => c.groupTitle), ["Network", "Servers"])
})

test("pressing the mark a part already has clears it", () => {
  assert.equal(nextPartMark(null, "GREEN"), "GREEN")
  assert.equal(nextPartMark("RED", "GREEN"), "GREEN")
  assert.equal(nextPartMark("GREEN", "GREEN"), "NONE")
  assert.equal(nextPartMark("RED", "RED"), "NONE")
})

test("All ticks sets every part, and clears when every part already has it", () => {
  assert.equal(allMarkTarget(product(), "GREEN"), "GREEN")
  const mixed = product({ parts: [{ id: "a", title: "S", note: null, mark: "GREEN" }, { id: "b", title: "M", note: null, mark: null }] })
  assert.equal(allMarkTarget(mixed, "GREEN"), "GREEN")
  const all = product({ parts: [{ id: "a", title: "S", note: null, mark: "RED" }, { id: "b", title: "M", note: null, mark: "RED" }] })
  assert.equal(allMarkTarget(all, "RED"), "NONE")
  assert.equal(allMarkTarget(all, "GREEN"), "GREEN")
  assert.equal(allMarkTarget(product({ parts: [] }), "GREEN"), "GREEN")
})

const overview = (o: Partial<HeatmapOverviewProduct> = {}): HeatmapOverviewProduct => ({
  id: "p", title: "Router", groupTitle: "Network", green: 20, red: 10, notChecked: 70, greenAccounts: [], redAccounts: [], ...o,
})

test("the dashboard bar is shares of all accounts, and absent when there are none", () => {
  assert.deepEqual(barShares(overview(), 100), { green: 20, red: 10, rest: 70 })
  assert.equal(barShares(overview({ green: 0, red: 0, notChecked: 0 }), 0), null)
})

test("the dashboard says how many accounts have been checked, or that there are none", () => {
  assert.equal(checkedLine({ accounts: 80, checkedAccounts: 42 }), "Accounts checked: 42 of 80")
  assert.equal(checkedLine({ accounts: 0, checkedAccounts: 0 }), "There are no accounts yet.")
})

test("the list editor says who uses a row, in plain words", () => {
  assert.equal(usedByText(0), "")
  assert.equal(usedByText(1), "Used by 1 account")
  assert.equal(usedByText(12), "Used by 12 accounts")
})

test("deleting a group or product warns that what is inside goes too", () => {
  assert.equal(deleteWarning("parts"), null)
  assert.equal(deleteWarning("products"), "This also deletes everything inside it.")
  assert.equal(deleteWarning("groups"), "This also deletes everything inside it.")
})
