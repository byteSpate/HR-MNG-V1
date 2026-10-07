import request from "supertest"
import { describe, expect, it } from "vitest"

import app from "../app"

describe("app wiring", () => {
  it("answers /health with a Server-Timing header", async () => {
    const res = await request(app).get("/health")

    expect(res.status).toBe(200)
    expect(res.headers["server-timing"]).toMatch(/^total;dur=\d/)
  })

  it("sets it on a 401 as well, so a bad token never hides the timing", async () => {
    const res = await request(app).get("/api/dashboard")

    expect(res.status).toBe(401)
    expect(res.headers["server-timing"]).toMatch(/^total;dur=\d/)
  })
})
