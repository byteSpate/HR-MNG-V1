import assert from "node:assert/strict"
import test from "node:test"

import { accountStats, opportunityStats, projectStats, taskStats } from "./sales-stats"

test("counts accounts by status and the ones that need a new owner", () => {
  const stats = accountStats([
    { status: "ACTIVE", ownerActive: true },
    { status: "ACTIVE", ownerActive: false },
    { status: "INACTIVE", ownerActive: true },
    { status: "DO_NOT_CONTACT", ownerActive: true },
  ])
  assert.deepEqual(stats, { total: 4, active: 2, notActive: 2, needsOwner: 1 })
})

test("an empty list of accounts counts zero of everything", () => {
  assert.deepEqual(accountStats([]), { total: 0, active: 0, notActive: 0, needsOwner: 0 })
})

test("counts Opportunities by status, with Lost and Cancelled together", () => {
  const stats = opportunityStats([
    { status: "ONGOING", amount: "100000.00" },
    { status: "ONGOING", amount: null },
    { status: "WON", amount: "50000" },
    { status: "LOST", amount: "10" },
    { status: "CANCELLED", amount: null },
  ])
  assert.equal(stats.ongoing, 2)
  assert.equal(stats.won, 1)
  assert.equal(stats.closedOther, 2)
})

test("sums only the Ongoing Opportunities that have a price, and counts the ones with none", () => {
  const stats = opportunityStats([
    { status: "ONGOING", amount: "100000.50" },
    { status: "ONGOING", amount: "0.25" },
    { status: "ONGOING", amount: null },
    { status: "WON", amount: "999999" },
  ])
  // Kept as a string, so 0.1 + 0.2 style float noise cannot reach the screen.
  assert.equal(stats.ongoingValue, "100000.75")
  assert.equal(stats.ongoingUnpriced, 1)
})

test("gives no value at all, not zero, when no Ongoing Opportunity has a price", () => {
  const stats = opportunityStats([{ status: "ONGOING", amount: null }, { status: "WON", amount: "5" }])
  assert.equal(stats.ongoingValue, null)
  assert.equal(stats.ongoingUnpriced, 1)
})

test("counts Projects by status, with Blocked and On hold together", () => {
  const stats = projectStats([
    { status: "NOT_STARTED" },
    { status: "IN_PROGRESS" },
    { status: "IN_PROGRESS" },
    { status: "BLOCKED" },
    { status: "ON_HOLD" },
    { status: "COMPLETED" },
    { status: "CANCELLED" },
  ])
  assert.deepEqual(stats, { total: 7, notStarted: 1, inProgress: 2, stuck: 2, completed: 1 })
})

test("counts pending, overdue, due-today and Project tasks, and ignores done and cancelled ones", () => {
  const stats = taskStats(
    [
      { status: "PENDING", dueOn: "2026-09-29", overdue: false, origin: "SELF" },
      { status: "PENDING", dueOn: "2026-09-20", overdue: true, origin: "PROJECT" },
      { status: "PENDING", dueOn: "2026-10-05", overdue: false, origin: "PROJECT" },
      { status: "DONE", dueOn: "2026-09-29", overdue: false, origin: "PROJECT" },
      { status: "CANCELLED", dueOn: "2026-09-29", overdue: false, origin: "PROJECT" },
    ],
    "2026-09-29",
  )
  assert.deepEqual(stats, { pending: 3, overdue: 1, dueToday: 1, done: 1, fromProject: 2 })
})
