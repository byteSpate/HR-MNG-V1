import assert from "node:assert/strict"
import test from "node:test"

import { QueryClient } from "@tanstack/react-query"

import { defaultQueryOptions } from "./default-options"

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
