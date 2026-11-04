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
    retry: shouldRetryQuery,
  },
}

/**
 * A refused request (a 4xx answer) says "no" about the request itself. Asking
 * again gives the same answer, so retrying only made the error screen wait
 * about 20 seconds. A server fault (5xx) or a lost connection can pass on a
 * second try, so those keep TanStack's default of 3 retries.
 *
 * It reads `status` instead of using `instanceof ApiError`, so this file does
 * not pull in the token code. A query that sets its own `retry` still wins.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status
  if (typeof status === "number" && status >= 400 && status < 500) return false
  return failureCount < 3
}

/**
 * For lists that change a few times a year: shifts, departments, leave types,
 * asset categories, VAT codes. Their settings panels clear the cache key when
 * somebody edits one, so this only hides a change made by somebody else in
 * the last ten minutes.
 */
export const REFERENCE_STALE_MS = 600_000
