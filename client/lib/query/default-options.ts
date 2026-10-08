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

/**
 * For lists that change a few times a year: shifts, departments, leave types,
 * asset categories, VAT codes. Their settings panels clear the cache key when
 * somebody edits one, so this only hides a change made by somebody else in
 * the last ten minutes.
 */
export const REFERENCE_STALE_MS = 600_000
