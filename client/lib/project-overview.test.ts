import assert from "node:assert/strict"
import test from "node:test"

import {
  dayText, daysLeftText, filterByHealth, linesDone, listEmptyState, nextMilestone,
  overviewScope, overviewStats, quietText,
} from "./project-overview"

test("says days left in easy words, late ones as late", () => {
  assert.equal(daysLeftText(7, "IN_PROGRESS"), "7 days left")
  assert.equal(daysLeftText(1, "IN_PROGRESS"), "1 day left")
  assert.equal(daysLeftText(0, "IN_PROGRESS"), "Due today")
  assert.equal(daysLeftText(-1, "IN_PROGRESS"), "1 day late")
  assert.equal(daysLeftText(-3, "BLOCKED"), "3 days late")
})

test("says so when there is no finish date, and calls a finished Project finished", () => {
  assert.equal(daysLeftText(null, "IN_PROGRESS"), "No finish date")
  assert.equal(daysLeftText(null, "COMPLETED"), "Finished")
  assert.equal(daysLeftText(null, "CANCELLED"), "Finished")
})

test("says how long a quiet Project has been quiet, or nothing", () => {
  assert.equal(quietText(9), "No update for 9 days")
  assert.equal(quietText(null), null)
})

test("writes a date as day, month, year, or Not set", () => {
  assert.equal(dayText("2026-10-05"), "05/10/2026")
  assert.equal(dayText("2026-10-05T00:00:00.000Z"), "05/10/2026")
  assert.equal(dayText(null), "Not set")
})

test("finds the next milestone: the earliest open one with a date, then the undated ones in order", () => {
  const list = [
    { title: "Done", doneAt: "2026-09-01T00:00:00.000Z", dueOn: "2026-09-01", order: 0 },
    { title: "Later", doneAt: null, dueOn: "2026-11-01", order: 1 },
    { title: "Sooner", doneAt: null, dueOn: "2026-10-10", order: 2 },
    { title: "Undated", doneAt: null, dueOn: null, order: 3 },
  ]
  assert.equal(nextMilestone(list)?.title, "Sooner")
  assert.equal(nextMilestone(list.filter((m) => m.dueOn === null || m.doneAt))?.title, "Undated")
  assert.equal(nextMilestone([list[0]]), null)
  assert.equal(nextMilestone([]), null)
})

test("counts the products ticked done", () => {
  assert.deepEqual(linesDone([{ done: { at: "x" } }, { done: null }, { done: { at: "y" } }]), { done: 2, total: 3 })
  assert.deepEqual(linesDone([]), { done: 0, total: 0 })
})

test("counts Projects for the five tiles", () => {
  const stats = overviewStats([
    { status: "IN_PROGRESS", health: "ON_TRACK", daysLeft: 30 },
    { status: "IN_PROGRESS", health: "LATE", daysLeft: -2 },
    { status: "IN_PROGRESS", health: "AT_RISK", daysLeft: 3 },
    { status: "BLOCKED", health: "AT_RISK", daysLeft: 7 },
    { status: "BLOCKED", health: null, daysLeft: 8 },
    { status: "COMPLETED", health: null, daysLeft: null },
    { status: "NOT_STARTED", health: null, daysLeft: 0 },
  ])
  // Active: only Projects in progress. Due this week: 0 to 7 days left, so 3, 7 and 0 (not 8, not -2).
  assert.deepEqual(stats, { total: 7, active: 3, late: 1, atRisk: 2, blocked: 2, dueThisWeek: 3 })
})

test("counts nothing for an empty list", () => {
  assert.deepEqual(overviewStats([]), { total: 0, active: 0, late: 0, atRisk: 0, blocked: 0, dueThisWeek: 0 })
})

test("says the tiles count the whole list only until the 200 row cap (Review Focus 5)", () => {
  assert.equal(overviewScope(0), "On this list")
  assert.equal(overviewScope(199), "On this list")
  assert.equal(overviewScope(200), "In the first 200 loaded")
  assert.equal(overviewScope(431), "In the first 200 loaded")
})

test("offers a way out when a filter matched nothing, and not when there is no Project at all (Review Focus 5)", () => {
  assert.deepEqual(listEmptyState(true), {
    title: "No Projects match these filters",
    body: "Try a different filter, or All.",
    action: "Clear the filter",
  })
  assert.deepEqual(listEmptyState(false), {
    title: "No Projects yet",
    body: "A Project starts from a Won Opportunity, on its Project tab.",
    action: null,
  })
})

test("filters the loaded rows by health, so a health with no Project gives an empty table (Review Focus 5)", () => {
  const rows = [
    { id: "a", health: "LATE" as const, status: "IN_PROGRESS", daysLeft: -1 },
    { id: "b", health: "ON_TRACK" as const, status: "IN_PROGRESS", daysLeft: 20 },
    { id: "c", health: null, status: "COMPLETED", daysLeft: null },
  ]
  assert.deepEqual(filterByHealth(rows, "").map((r) => r.id), ["a", "b", "c"])
  assert.deepEqual(filterByHealth(rows, "LATE").map((r) => r.id), ["a"])
  // A health nobody has: an empty table, not the whole list.
  assert.deepEqual(filterByHealth(rows, "AT_RISK"), [])
  // And the tiles follow the filter, so they read zero rather than the whole list.
  assert.deepEqual(overviewStats(filterByHealth(rows, "AT_RISK")), {
    total: 0, active: 0, late: 0, atRisk: 0, blocked: 0, dueThisWeek: 0,
  })
  // A Project with no health is not "On track": it never matches a health filter.
  assert.deepEqual(filterByHealth(rows, "ON_TRACK").map((r) => r.id), ["b"])
})
