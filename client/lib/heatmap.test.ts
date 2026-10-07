import assert from "node:assert/strict"
import test from "node:test"

import type { HeatmapCardView, HeatmapItemView } from "./api/types"
import { COLOUR, dayText, detailsLine, draftOfItem, itemBodyOf, itemTitle } from "./heatmap"

const SWITCH = {
  key: "switch",
  title: "Switch",
  quantityLabel: "How many",
  endsLabel: "Warranty or support ends",
  extras: [
    { key: "ports", label: "Ports on each switch", type: "NUMBER", options: null },
    { key: "poe", label: "PoE", type: "YES_NO", options: null },
    { key: "speed", label: "Speed", type: "CHOICE", options: ["1G", "10G"] },
  ],
} as unknown as HeatmapCardView

const FIREWALL = {
  extras: [{ key: "licenceEndsOn", label: "Licence ends", type: "DATE", options: null }],
} as unknown as HeatmapCardView

const ITEM: HeatmapItemView = {
  id: "i-1", brand: "Cisco", model: "C9200-24P", quantity: 24, site: "Head office", boughtFrom: null,
  boughtOn: "2022-01-10", supportEndsOn: "2027-03-03", endOfLifeOn: null, supportBy: null, notes: null,
  details: { ports: "24", poe: "YES" }, recordedByName: "Rahim", recordedAt: "2026-09-21T00:00:00.000Z",
}

test("every colour has its plain words", () => {
  assert.equal(COLOUR.GREEN.word, "Chance now")
  assert.equal(COLOUR.YELLOW.word, "Chance later")
  assert.equal(COLOUR.RED.word, "No chance")
  assert.equal(COLOUR.GREY.word, "Not checked")
})

test("a new item starts with one of it and empty boxes", () => {
  const draft = draftOfItem()
  assert.equal(draft.brand, "")
  assert.equal(draft.quantity, "1")
  assert.deepEqual(draft.details, {})
})

test("an item being edited starts with what is saved", () => {
  const draft = draftOfItem(ITEM)
  assert.equal(draft.model, "C9200-24P")
  assert.equal(draft.quantity, "24")
  assert.equal(draft.boughtFrom, "")
  assert.deepEqual(draft.details, { ports: "24", poe: "YES" })
})

test("the body sends blanks as nothing and the count as a number", () => {
  const result = itemBodyOf({ ...draftOfItem(ITEM), site: "  ", quantity: " 24 " })
  assert.ok("body" in result)
  assert.equal(result.body.site, null)
  assert.equal(result.body.quantity, 24)
  assert.equal(result.body.supportEndsOn, "2027-03-03")
})

test("the body drops empty extra fields", () => {
  const result = itemBodyOf({ ...draftOfItem(), brand: "HP", details: { ports: "", poe: "NO" } })
  assert.ok("body" in result)
  assert.deepEqual(result.body.details, { poe: "NO" })
})

test("the form asks for the brand and a whole count first", () => {
  assert.deepEqual(itemBodyOf({ ...draftOfItem(), brand: " " }), { error: "Write the brand." })
  assert.deepEqual(itemBodyOf({ ...draftOfItem(), brand: "HP", quantity: "0" }), { error: "How many must be a whole number, 1 or more." })
  assert.deepEqual(itemBodyOf({ ...draftOfItem(), brand: "HP", quantity: "2.5" }), { error: "How many must be a whole number, 1 or more." })
})

test("an item's name is its brand and model", () => {
  assert.equal(itemTitle(ITEM), "Cisco C9200-24P")
  assert.equal(itemTitle({ ...ITEM, model: null }), "Cisco")
})

test("a date reads the short way, and never moves a day", () => {
  assert.equal(dayText("2027-03-03"), "3 Mar 2027")
  assert.equal(dayText("2027-01-01"), "1 Jan 2027")
})

test("the extra fields read as one line, with Yes or No and real dates", () => {
  assert.equal(detailsLine(SWITCH, ITEM), "Ports on each switch: 24 · PoE: Yes")
  assert.equal(detailsLine(FIREWALL, { ...ITEM, details: { licenceEndsOn: "2027-06-30" } }), "Licence ends: 30 Jun 2027")
  assert.equal(detailsLine(SWITCH, { ...ITEM, details: {} }), "")
})
