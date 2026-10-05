import assert from "node:assert/strict"
import test from "node:test"

import { permissionAllows } from "./permission-state"

test("always allows a Sales Admin", () => {
  assert.equal(permissionAllows({ isAdmin: true, permissions: { "task.create": false }, key: "task.create" }), true)
})

test("follows the switch for a Sales User", () => {
  assert.equal(permissionAllows({ isAdmin: false, permissions: { "task.create": false }, key: "task.create" }), false)
  assert.equal(permissionAllows({ isAdmin: false, permissions: { "task.create": true }, key: "task.create" }), true)
})

test("does not allow anything before the answer has arrived", () => {
  assert.equal(permissionAllows({ isAdmin: false, permissions: undefined, key: "task.create" }), false)
})
