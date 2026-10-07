import express from "express"
import request from "supertest"
import { afterEach, describe, expect, it, vi } from "vitest"

import { getContext } from "./request-context"
import { requestMetrics } from "./request-metrics"

// Same order as app.ts: the body is read first, so the context set by
// requestMetrics covers the handler. A body parser placed after it would run
// outside the context, and a POST would count zero queries.
function makeApp(log: boolean) {
  const app = express()
  app.use(express.json())
  app.use(requestMetrics({ log }))
  app.get("/ok", (_req, res) => {
    getContext()?.recordQuery(5)
    getContext()?.recordQuery(7)
    res.json({ ok: true })
  })
  app.post("/echo", (req, res) => {
    getContext()?.recordQuery(1)
    res.json(req.body)
  })
  app.get("/slow/:n", async (req, res) => {
    const n = Number(req.params.n)
    for (let i = 0; i < n; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2))
      getContext()?.recordQuery(1)
    }
    res.json({ n })
  })
  app.get("/boom", (_req, res) => {
    res.status(500).json({ error: "boom" })
  })
  return app
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("Server-Timing header", () => {
  it("reports total time, database time with the query count, and pool wait", async () => {
    const res = await request(makeApp(false)).get("/ok")

    expect(res.status).toBe(200)
    const header = res.headers["server-timing"]
    expect(header).toMatch(/^total;dur=\d+(\.\d)?, /)
    expect(header).toContain('db;dur=12.0;desc="queries=2"')
    expect(header).toMatch(/poolwait;dur=0\.0;desc="max=0\.0"/)
  })

  it("counts queries made while a POST body is handled", async () => {
    const res = await request(makeApp(false)).post("/echo").send({ a: 1 })

    expect(res.body).toEqual({ a: 1 })
    expect(res.headers["server-timing"]).toContain('desc="queries=1"')
  })

  it("keeps two requests that run at the same time apart", async () => {
    const app = makeApp(false)
    const [a, b] = await Promise.all([request(app).get("/slow/3"), request(app).get("/slow/5")])

    expect(a.headers["server-timing"]).toContain('desc="queries=3"')
    expect(b.headers["server-timing"]).toContain('desc="queries=5"')
  })

  it("is still set when the route answers 500", async () => {
    const res = await request(makeApp(false)).get("/boom")

    expect(res.status).toBe(500)
    expect(res.headers["server-timing"]).toMatch(/^total;dur=/)
  })

  it("is still set on a route that does not exist", async () => {
    const res = await request(makeApp(false)).get("/nope")

    expect(res.status).toBe(404)
    expect(res.headers["server-timing"]).toMatch(/^total;dur=/)
    expect(res.headers["server-timing"]).toContain('desc="queries=0"')
  })
})

describe("log line", () => {
  it("writes one JSON line per request when logging is on", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined)

    await request(makeApp(true)).get("/ok")
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))

    const line = JSON.parse(String(spy.mock.calls[0][0]))
    expect(line).toMatchObject({ t: "req", method: "GET", route: "/ok", status: 200, queries: 2 })
    expect(typeof line.ms).toBe("number")
    expect(typeof line.rssMb).toBe("number")
  })

  it("writes nothing when logging is off", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined)

    await request(makeApp(false)).get("/ok")
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(spy).not.toHaveBeenCalled()
  })

  it("logs a 500 and a 404 too", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const app = makeApp(true)

    await request(app).get("/boom")
    await request(app).get("/nope")
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(2))

    const statuses = spy.mock.calls.map((c) => JSON.parse(String(c[0])).status)
    expect(statuses).toEqual([500, 404])
  })
})
