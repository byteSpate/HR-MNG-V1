import type { DefaultOptions } from "@tanstack/react-query"

/**
 * Before this, every query was stale the moment it arrived, so each page
 * visit and each click back into the tab fetched everything again.
 *
 * 30 seconds is short on purpose. Mutations already invalidate their own
 * queries, so this only hides data that someone else changed in that time.
 * A query that must always be fresh (the punch state) sets `staleTime: 0`.
 */
export const defaultQueryOptions: DefaultOptions = {
  queries: {
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  },
}
