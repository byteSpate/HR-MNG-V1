import assert from "node:assert/strict"
import test from "node:test"

import { canManageEmployees } from "./employee-access"

test("HR Admin and Super Admin can manage employees", () => {
  assert.equal(canManageEmployees("HR_ADMIN"), true)
  assert.equal(canManageEmployees("SUPER_ADMIN"), true)
})

test("every other role, and nobody signed in, cannot", () => {
  assert.equal(canManageEmployees("FINANCE_OFFICER"), false)
  assert.equal(canManageEmployees("REPORTING_MANAGER"), false)
  assert.equal(canManageEmployees("EMPLOYEE"), false)
  assert.equal(canManageEmployees(undefined), false)
})
