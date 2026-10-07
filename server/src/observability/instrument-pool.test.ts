import { describe, expect, it } from "vitest"

import { instrumentPool, type PoolLike } from "./instrument-pool"
import { createContext, runWithContext } from "./request-context"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

class FakeClient {
  query(...args: unknown[]): unknown {
    const last = args[args.length - 1]
    if (typeof last === "function") {
      setTimeout(() => (last as (e: null, r: object) => void)(null, { rows: [] }), 2)
      return undefined
    }
    return sleep(2).then(() => ({ rows: [] }))
  }
}

/** A pool where the test decides when a queued `connect(callback)` is answered. */
function makeFakePool(connectDelayMs = 5) {
  const client = new FakeClient()
  let pending: ((err: null, client: FakeClient, release: () => void) => void) | undefined
  const pool = {
    waitingCount: 0,
    connect(cb?: (err: null, client: FakeClient, release: () => void) => void): unknown {
      if (typeof cb === "function") {
        pending = cb
        return undefined
      }
      return sleep(connectDelayMs).then(() => client)
    },
  }
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pool: pool as unknown as PoolLike & Record<string, any>,
    client,
    answerPending: () => pending!(null, client, () => undefined),
  }
}

describe("instrumentPool", () => {
  it("counts every query on a connection taken with the promise form (a transaction)", async () => {
    const { pool } = makeFakePool()
    instrumentPool(pool)
    const ctx = createContext()

    await runWithContext(ctx, async () => {
      const client = await pool.connect()
      await client.query("BEGIN")
      await client.query("select 1")
      await client.query("COMMIT")
    })

    expect(ctx.queries).toBe(3)
    expect(ctx.dbMs).toBeGreaterThan(0)
  })

  it("measures the wait for a connection", async () => {
    const { pool } = makeFakePool(8)
    instrumentPool(pool)
    pool.waitingCount = 3
    const ctx = createContext()

    await runWithContext(ctx, async () => {
      await pool.connect()
    })

    expect(ctx.poolWaitMs).toBeGreaterThan(0)
    expect(ctx.maxPoolWaitMs).toBeGreaterThan(0)
    expect(ctx.maxQueued).toBe(3)
  })

  it("charges a query to the request that asked, even when another request hands the connection over", async () => {
    const { pool, client, answerPending } = makeFakePool()
    instrumentPool(pool)
    const asker = createContext()
    const releaser = createContext()

    const finished = new Promise<void>((resolve) => {
      runWithContext(asker, () => {
        pool.connect((_err: unknown, c: FakeClient) => {
          c.query("select 1", [], () => resolve())
        })
      })
    })
    // The pool answers the waiting callback from inside another request.
    runWithContext(releaser, () => answerPending())
    await finished

    expect(asker.queries).toBe(1)
    expect(releaser.queries).toBe(0)
    expect(client).toBeDefined()
  })

  it("keeps two requests that run at the same time apart", async () => {
    const { pool } = makeFakePool()
    instrumentPool(pool)
    const a = createContext()
    const b = createContext()

    const work = (ctx: ReturnType<typeof createContext>, n: number) =>
      runWithContext(ctx, async () => {
        for (let i = 0; i < n; i++) {
          const client = await pool.connect()
          await client.query("select 1")
        }
      })
    await Promise.all([work(a, 3), work(b, 5)])

    expect(a.queries).toBe(3)
    expect(b.queries).toBe(5)
  })

  it("does not count a query twice when the same connection is taken again", async () => {
    const { pool } = makeFakePool()
    instrumentPool(pool)
    const ctx = createContext()

    await runWithContext(ctx, async () => {
      const first = await pool.connect()
      await first.query("select 1")
      const second = await pool.connect() // the same object comes back
      await second.query("select 1")
    })

    expect(ctx.queries).toBe(2)
  })

  it("lets a query through when there is no request context (a cron job or a script)", async () => {
    const { pool } = makeFakePool()
    instrumentPool(pool)

    const client = await pool.connect()
    await expect(client.query("select 1")).resolves.toEqual({ rows: [] })
  })
})
