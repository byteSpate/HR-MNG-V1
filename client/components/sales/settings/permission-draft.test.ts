import assert from "node:assert/strict"
import test from "node:test"

import type { SalesPermissionRow } from "../../../lib/api/types"
import { groupPermissions, lastChangeOf, pendingChanges } from "./permission-draft"

const row = (over: Partial<SalesPermissionRow>): SalesPermissionRow => ({
  key: "task.create",
  label: "Create a Task",
  group: "Tasks and Weekly Report",
  phase: 1,
  default: true,
  enabled: true,
  changedAt: null,
  changedByName: null,
  ...over,
})

test("groups in the order the groups first appear, and drops Phase 2 rows", () => {
  const groups = groupPermissions([
    row({ key: "account.edit", group: "Sales Accounts" }),
    row({ key: "task.create", group: "Tasks and Weekly Report" }),
    row({ key: "weekly.submit", group: "Tasks and Weekly Report" }),
    row({ key: "target.set", group: "Team and Targets", phase: 2 }),
  ])
  assert.deepEqual(
    groups.map((g) => g.group),
    ["Sales Accounts", "Tasks and Weekly Report"]
  )
  assert.deepEqual(
    groups[1].rows.map((r) => r.key),
    ["task.create", "weekly.submit"]
  )
})

test("lists only the switches whose draft differs from the saved value", () => {
  const rows = [row({ key: "task.create", enabled: true }), row({ key: "weekly.submit", enabled: true })]
  assert.deepEqual(pendingChanges(rows, { "task.create": false, "weekly.submit": true }), [
    { key: "task.create", enabled: false },
  ])
})

test("pendingChanges is empty when nothing was touched", () => {
  assert.deepEqual(pendingChanges([row({})], {}), [])
})

test("lastChangeOf answers the newest change in the group", () => {
  const last = lastChangeOf([
    row({ changedAt: "2026-10-01T00:00:00.000Z", changedByName: "Karim" }),
    row({ changedAt: "2026-10-05T00:00:00.000Z", changedByName: "Rahim" }),
    row({ changedAt: null }),
  ])
  assert.deepEqual(last, { changedAt: "2026-10-05T00:00:00.000Z", changedByName: "Rahim" })
})

test("lastChangeOf answers null when nobody ever changed the group", () => {
  assert.equal(lastChangeOf([row({})]), null)
})
