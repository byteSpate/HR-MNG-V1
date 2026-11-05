import express from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"

import { createAuthRateLimit } from "./authRateLimit"

function makeApp(max = 2) {
  const app = express()
  app.set("trust proxy", 1)
  app.post("/x", createAuthRateLimit({ max, windowMs: 60_000 }), (_req, res) => {
    res.json({ ok: true })
  })
  return app
}

describe("createAuthRateLimit", () => {
  it("allows the first 2 tries", async () => {
    const app = makeApp()
    await request(app).post("/x").expect(200)
    await request(app).post("/x").expect(200)
  })

  it("refuses the 3rd with 429 and an easy English error", async () => {
    const app = makeApp()
    await request(app).post("/x")
    await request(app).post("/x")
    const res = await request(app).post("/x")
    expect(res.status).toBe(429)
    expect(res.body.error).toMatch(/Too many tries/)
    expect(res.body.error).toMatch(/Wait/)
    expect(res.headers["retry-after"]).toBeDefined()
  })

  it("with skipSuccessful, only failed tries count, so a whole office can sign in", async () => {
    const app = express()
    app.post("/ok", createAuthRateLimit({ max: 2, windowMs: 60_000, skipSuccessful: true }), (_req, res) => {
      res.json({ ok: true })
    })
    app.post("/bad", createAuthRateLimit({ max: 2, windowMs: 60_000, skipSuccessful: true }), (_req, res) => {
      res.status(401).json({ error: "no" })
    })
    for (let i = 0; i < 5; i++) await request(app).post("/ok").expect(200)
    await request(app).post("/bad").expect(401)
    await request(app).post("/bad").expect(401)
    await request(app).post("/bad").expect(429)
  })

  it("counts each IP separately", async () => {
    const app = makeApp(1)
    await request(app).post("/x").set("X-Forwarded-For", "1.1.1.1").expect(200)
    await request(app).post("/x").set("X-Forwarded-For", "1.1.1.1").expect(429)
    await request(app).post("/x").set("X-Forwarded-For", "2.2.2.2").expect(200)
  })
})
