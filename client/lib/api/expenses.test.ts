import assert from "node:assert/strict"
import test from "node:test"

import { getOutstandingExpenseReimbursements } from "./expenses"

test("getOutstandingExpenseReimbursements calls the dedicated finance endpoint", async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  let requested = ""
  globalThis.fetch = async (input) => {
    requested = String(input)
    return Response.json({ rows: [], totals: { claims: 0, byCurrency: [] } })
  }

  const result = await getOutstandingExpenseReimbursements("access-token")

  assert.match(requested, /\/api\/expenses\/outstanding-reimbursements$/)
  assert.deepEqual(result, { rows: [], totals: { claims: 0, byCurrency: [] } })
})
