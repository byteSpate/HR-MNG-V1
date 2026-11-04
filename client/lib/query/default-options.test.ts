import assert from "node:assert/strict"
import test from "node:test"

import { QueryClient } from "@tanstack/react-query"

import { defaultQueryOptions, REFERENCE_STALE_MS, shouldRetryQuery } from "./default-options"

test("a list stays fresh for 30 seconds, so going back to a page does not fetch it again", () => {
  const client = new QueryClient({ defaultOptions: defaultQueryOptions })
  assert.equal(client.getDefaultOptions().queries?.staleTime, 30_000)
})

test("coming back to the tab does not refetch every query", () => {
  const client = new QueryClient({ defaultOptions: defaultQueryOptions })
  assert.equal(client.getDefaultOptions().queries?.refetchOnWindowFocus, false)
})

test("a query can still ask for fresh data every time", async () => {
  const client = new QueryClient({ defaultOptions: defaultQueryOptions })
  let calls = 0
  const run = () =>
    client.fetchQuery({
      queryKey: ["x"],
      queryFn: async () => ++calls,
      staleTime: 0,
    })

  await run()
  await run()

  assert.equal(calls, 2)
})

test("a refused request (4xx) is never retried, so the error shows at once", () => {
  for (const status of [400, 401, 403, 404, 409, 429]) {
    assert.equal(shouldRetryQuery(0, { status }), false, `status ${status}`)
  }
})

test("a server fault (5xx) and a network failure are retried, up to 3 times", () => {
  assert.equal(shouldRetryQuery(0, { status: 500 }), true)
  assert.equal(shouldRetryQuery(2, { status: 503 }), true)
  assert.equal(shouldRetryQuery(3, { status: 500 }), false)
  assert.equal(shouldRetryQuery(0, new Error("Failed to fetch")), true)
  assert.equal(shouldRetryQuery(3, new Error("Failed to fetch")), false)
})

test("every query uses that retry rule unless it sets its own", () => {
  assert.equal(defaultQueryOptions.queries?.retry, shouldRetryQuery)
})

test("settings lists stay fresh longer than an ordinary list", () => {
  assert.equal(REFERENCE_STALE_MS, 600_000)
  assert.ok(REFERENCE_STALE_MS > (defaultQueryOptions.queries?.staleTime as number))
})
