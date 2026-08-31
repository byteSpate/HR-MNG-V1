import assert from "node:assert/strict"
import test from "node:test"

import { ApiError } from "./client"
import { downloadStatementsPdf } from "./statements"

test("downloadStatementsPdf preserves the server refusal message", async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: "Set a cash-flow section on account 1242 before generating statements.",
      }),
      {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }
    )

  await assert.rejects(
    downloadStatementsPdf("access-token", { from: "2026-07-01", to: "2027-06-30" }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.status, 409)
      assert.equal(
        error.message,
        "Set a cash-flow section on account 1242 before generating statements."
      )
      return true
    }
  )
})
