import { getContext, type RequestContext } from "./request-context"

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface PoolLike {
  connect: (...args: any[]) => any
  waitingCount: number
}

interface WrappedClient {
  query: (...args: any[]) => any
  __perfWrapped?: boolean
  __perfCtx?: RequestContext
}

function wrapClient(client: WrappedClient): void {
  if (client.__perfWrapped) return
  client.__perfWrapped = true
  const original = client.query.bind(client)

  client.query = (...args: any[]) => {
    // Set when the connection was taken, by the request that asked for it.
    const ctx = client.__perfCtx
    if (!ctx) return original(...args)

    const start = performance.now()
    const done = () => ctx.recordQuery(performance.now() - start)

    // `pool.query()` uses the callback form inside pg-pool.
    const last = args[args.length - 1]
    if (typeof last === "function") {
      args[args.length - 1] = (...cbArgs: any[]) => {
        done()
        return last(...cbArgs)
      }
      return original(...args)
    }

    const result = original(...args)
    if (result && typeof result.then === "function") return result.finally(done)
    done()
    return result
  }
}

/**
 * Counts every statement and every wait for a connection, per request.
 *
 * Why the wrapper reads the context when `connect` is CALLED: when the pool is
 * full, the callback of a waiting `connect` runs from the request that gave
 * the connection back. Reading the context there would charge the wrong
 * request. So the context is read at call time and kept on the client.
 *
 * It changes nothing for the caller. Without a request context (a cron job, a
 * script) every call goes straight through.
 */
export function instrumentPool(pool: PoolLike): void {
  const originalConnect = pool.connect.bind(pool)

  pool.connect = (...args: any[]) => {
    const ctx = getContext()
    const start = performance.now()
    const queued = pool.waitingCount

    const onAcquire = (client: WrappedClient | undefined) => {
      if (!client) return
      ctx?.recordPoolWait(performance.now() - start, queued)
      client.__perfCtx = ctx
      wrapClient(client)
    }

    const cb = args[0]
    if (typeof cb === "function") {
      return originalConnect((err: unknown, client: WrappedClient | undefined, release: unknown) => {
        if (!err) onAcquire(client)
        return cb(err, client, release)
      })
    }
    return originalConnect(...args).then((client: WrappedClient) => {
      onAcquire(client)
      return client
    })
  }
}
