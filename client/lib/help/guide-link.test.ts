import assert from "node:assert/strict"
import test from "node:test"

import { guideHrefFor } from "./guide-link"

test("Admin and Finance get a link to their own accounting guide, at the step", () => {
  assert.equal(guideHrefFor("/admin/accounting/journals", "journals"), "/admin/accounting/guide#journals")
  assert.equal(guideHrefFor("/finance/costs", "costs"), "/finance/accounting/guide#costs")
})

test("with no step the link goes to the setup section", () => {
  assert.equal(guideHrefFor("/finance/costs", undefined), "/finance/accounting/guide#setup")
})

test("HR, Manager and Employee have no accounting guide, so there is no link (it would be a 404)", () => {
  assert.equal(guideHrefFor("/hr/costs", "costs"), null)
  assert.equal(guideHrefFor("/manager/payroll", "payroll"), null)
  assert.equal(guideHrefFor("/employee/expenses", "expenses"), null)
})

test("a path outside the role areas has no link", () => {
  assert.equal(guideHrefFor("/sales/accounts", "accounts"), null)
  assert.equal(guideHrefFor("", "accounts"), null)
})
