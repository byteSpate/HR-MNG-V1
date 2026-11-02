import assert from "node:assert/strict"
import test from "node:test"

import type { SalesTaskSummary } from "@/lib/api/types"
import { logDaySlots, shiftWeek, weekRange, weekStartOf } from "./logs-days"

const task = (id: string, overrides: Partial<SalesTaskSummary> = {}): SalesTaskSummary => ({
  id, origin: "SELF", type: "OTHER", givenByName: null, givenOn: null,
  salesAccountId: null, salesAccountName: null, opportunityId: null, opportunitySerial: null, opportunityName: null,
  meetingId: null, meetingTitle: null, title: id, detail: null, dueOn: "2026-09-08", priority: "NORMAL",
  assignedToEmployeeId: "emp-1", assignedToName: "Rahim", status: "PENDING", outcome: null, cancelReason: null,
  completedAt: null, doneOn: null, overdue: false, canManage: true, createdAt: "2026-09-06T06:00:00.000Z",
  ...overrides,
})

test("weekStartOf gives the Sunday of the week", () => {
  assert.equal(weekStartOf("2026-09-06"), "2026-09-06") // Sunday
  assert.equal(weekStartOf("2026-09-09"), "2026-09-06") // Wednesday
  assert.equal(weekStartOf("2026-09-10"), "2026-09-06") // Thursday
})

test("weekStartOf keeps Friday with the week that just ended, and lets Saturday open the next one", () => {
  assert.equal(weekStartOf("2026-09-11"), "2026-09-06") // Friday
  assert.equal(weekStartOf("2026-09-12"), "2026-09-13") // Saturday
})

test("shiftWeek moves by whole weeks, across a month end", () => {
  assert.equal(shiftWeek("2026-09-06", 1), "2026-09-13")
  assert.equal(shiftWeek("2026-09-06", -1), "2026-08-30")
  assert.equal(shiftWeek("2026-09-06", 0), "2026-09-06")
})

test("weekRange covers the Saturday before to the Friday after Thursday", () => {
  assert.deepEqual(weekRange("2026-09-06"), { from: "2026-09-05", to: "2026-09-11" })
})

test("logDaySlots always has Sunday to Thursday, named", () => {
  const slots = logDaySlots("2026-09-06", [])
  assert.deepEqual(slots.map((s) => s.date), ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"])
  assert.deepEqual(slots.map((s) => s.label), ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"])
  assert.ok(slots.every((s) => s.tasks.length === 0))
})

test("logDaySlots puts a done task under the day it was done and any other under its due day", () => {
  const slots = logDaySlots("2026-09-06", [
    task("done", { status: "DONE", doneOn: "2026-09-07", dueOn: "2026-09-10", completedAt: "2026-09-07T04:00:00.000Z" }),
    task("plan", { dueOn: "2026-09-09" }),
  ])
  const byDate = Object.fromEntries(slots.map((s) => [s.date, s.tasks.map((t) => t.id)]))
  assert.deepEqual(byDate["2026-09-07"], ["done"])
  assert.deepEqual(byDate["2026-09-09"], ["plan"])
  assert.deepEqual(byDate["2026-09-10"], [])
})

test("logDaySlots adds Friday and the Saturday before only when they hold a task", () => {
  const slots = logDaySlots("2026-09-06", [
    task("fri", { dueOn: "2026-09-11" }),
    task("sat", { dueOn: "2026-09-05" }),
  ])
  assert.deepEqual(slots.map((s) => s.date), [
    "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11",
  ])
  assert.equal(slots[0].label, "Saturday")
  assert.equal(slots.at(-1)?.label, "Friday")
})

test("logDaySlots ignores a task that falls outside the week", () => {
  const slots = logDaySlots("2026-09-06", [task("late", { dueOn: "2026-09-20" })])
  assert.ok(slots.every((s) => s.tasks.length === 0))
  assert.equal(slots.length, 5)
})
