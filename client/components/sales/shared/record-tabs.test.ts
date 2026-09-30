import assert from "node:assert/strict"
import test from "node:test"

import { pickTab } from "./record-tabs"

const tabs = [{ value: "overview" }, { value: "details" }, { value: "tasks" }]

test("a link with no tab opens the first one, so Overview is where a Project starts", () => {
  assert.equal(pickTab(tabs, null), "overview")
  assert.equal(pickTab(tabs, ""), "overview")
})

test("a tab that has gone opens the first one rather than nothing", () => {
  // A hand-edited or stale `?tab=` must never leave the page blank.
  assert.equal(pickTab(tabs, "money"), "overview")
  assert.equal(pickTab(tabs, "OVERVIEW"), "overview")
})

test("a tab that exists is opened", () => {
  assert.equal(pickTab(tabs, "details"), "details")
  assert.equal(pickTab(tabs, "tasks"), "tasks")
})

test("a tab that has gone away falls back, because Money only shows once Won", () => {
  // The reader is on Money, then the Opportunity is reopened and it is no longer
  // Won, so the tab is gone from the list. The page must still render one.
  const afterReopen = [{ value: "overview" }, { value: "details" }]
  assert.equal(pickTab(afterReopen, "money"), "overview")
  // The same tab is still opened while it is on the list.
  const whileWon = [{ value: "overview" }, { value: "details" }, { value: "money" }]
  assert.equal(pickTab(whileWon, "money"), "money")
})
