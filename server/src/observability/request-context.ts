import { AsyncLocalStorage } from "node:async_hooks"

/**
 * What one request has cost so far.
 *
 * `queries` counts every statement sent to the database, including BEGIN and
 * COMMIT. Each one is a trip over the network, and the trip is what costs
 * time when the database is far away.
 */
export interface RequestContext {
  queries: number
  /** Sum of the time of every query. Queries that overlap add up, so this can be more than the request time. */
  dbMs: number
  /** Sum of the time spent waiting for a free connection. */
  poolWaitMs: number
  /** The longest single wait for a connection. */
  maxPoolWaitMs: number
  /** The most requests that were already queued for a connection when this one asked. */
  maxQueued: number
  recordQuery(ms: number): void
  recordPoolWait(ms: number, queued: number): void
}

const storage = new AsyncLocalStorage<RequestContext>()

export function createContext(): RequestContext {
  const ctx: RequestContext = {
    queries: 0,
    dbMs: 0,
    poolWaitMs: 0,
    maxPoolWaitMs: 0,
    maxQueued: 0,
    recordQuery(ms) {
      ctx.queries += 1
      ctx.dbMs += ms
    },
    recordPoolWait(ms, queued) {
      ctx.poolWaitMs += ms
      ctx.maxPoolWaitMs = Math.max(ctx.maxPoolWaitMs, ms)
      ctx.maxQueued = Math.max(ctx.maxQueued, queued)
    },
  }
  return ctx
}

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn)
}

export function getContext(): RequestContext | undefined {
  return storage.getStore()
}
