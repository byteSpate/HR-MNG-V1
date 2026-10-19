import assert from "node:assert/strict"
import test from "node:test"

import type { DocumentLinkSummary } from "./api/types"
import { costingLinks, lockedLine } from "./costing-links"

const link = (o: Partial<DocumentLinkSummary>): DocumentLinkSummary => ({
  id: "d", opportunityId: "o", name: "Costing v1", url: "https://x.com", stage: "COMMERCIAL_NEGOTIATION",
  kind: "COSTING_BOQ", quoteId: null, locked: false, createdBy: "u", createdByName: null,
  createdAt: "2026-10-18T00:00:00.000Z", canRemove: false, ...o,
})

test("keeps only Costing and BOQ links, for one quote when asked", () => {
  const links = [
    link({ id: "a", quoteId: "q1" }),
    link({ id: "b", quoteId: "q2" }),
    link({ id: "c", kind: "GENERAL", quoteId: "q1" }),
    link({ id: "d", quoteId: null }),
  ]
  assert.deepEqual(costingLinks(links).map((l) => l.id), ["a", "b", "d"])
  assert.deepEqual(costingLinks(links, "q1").map((l) => l.id), ["a"])
})

test("says how many links only admins can open, in plain words", () => {
  assert.equal(lockedLine(1), "1 link (only admins can open it)")
  assert.equal(lockedLine(3), "3 links (only admins can open them)")
})
