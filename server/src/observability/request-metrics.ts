import type { NextFunction, Request, Response } from "express"
import onHeaders from "on-headers"

import { createContext, runWithContext, type RequestContext } from "./request-context"

export interface RequestMetricsOptions {
  /** Write one JSON line per request to the console. Heroku keeps it in the log. */
  log: boolean
}

const round = (n: number) => Math.round(n * 10) / 10

/** The route as written in the code (`/api/deal-money/deals/:opportunityId`), so one route is one label. */
function routeLabel(req: Request): string {
  const path = req.route?.path
  return typeof path === "string" ? `${req.baseUrl}${path}` : req.originalUrl.split("?")[0]
}

export function serverTiming(totalMs: number, ctx: RequestContext): string {
  return [
    `total;dur=${totalMs.toFixed(1)}`,
    `db;dur=${ctx.dbMs.toFixed(1)};desc="queries=${ctx.queries}"`,
    `poolwait;dur=${ctx.poolWaitMs.toFixed(1)};desc="max=${ctx.maxPoolWaitMs.toFixed(1)}"`,
  ].join(", ")
}

/**
 * Times a request and counts its database work.
 *
 * Put it AFTER `express.json()`. The body is read from the socket, and code
 * that runs from a socket event is outside the context this middleware sets.
 * The time spent reading the body is not counted in `total`. That is fine,
 * because the body is small and the database is the cost we want to see.
 */
export function requestMetrics({ log }: RequestMetricsOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = performance.now()
    const ctx = createContext()

    onHeaders(res, () => {
      res.setHeader("Server-Timing", serverTiming(performance.now() - start, ctx))
    })

    if (log) {
      // "close" fires for every request, also when the client hangs up early.
      res.once("close", () => {
        const memory = process.memoryUsage()
        console.log(
          JSON.stringify({
            t: "req",
            method: req.method,
            route: routeLabel(req),
            status: res.statusCode,
            ms: round(performance.now() - start),
            queries: ctx.queries,
            dbMs: round(ctx.dbMs),
            poolWaitMs: round(ctx.poolWaitMs),
            maxPoolWaitMs: round(ctx.maxPoolWaitMs),
            maxQueued: ctx.maxQueued,
            rssMb: Math.round(memory.rss / 1048576),
            heapMb: Math.round(memory.heapUsed / 1048576),
          })
        )
      })
    }

    runWithContext(ctx, next)
  }
}
