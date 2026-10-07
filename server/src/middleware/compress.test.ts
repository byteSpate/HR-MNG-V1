import express from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"

import { compressResponses } from "./compress"

const BIG = { rows: Array.from({ length: 200 }, (_, i) => ({ id: i, name: `employee number ${i}`, status: "ACTIVE" })) }

function makeApp() {
  const app = express()
  app.use(compressResponses())
  app.get("/big", (_req, res) => res.json(BIG))
  app.get("/small", (_req, res) => res.json({ ok: true }))
  app.get("/empty", (_req, res) => res.status(204).end())
  app.get("/text", (_req, res) => res.type("text/plain").send("x".repeat(5000)))
  return app
}

describe("compressResponses", () => {
  it("gzips a large JSON body when the client accepts gzip, and the body is unchanged", async () => {
    const res = await request(makeApp()).get("/big").set("Accept-Encoding", "gzip")

    expect(res.headers["content-encoding"]).toBe("gzip")
    expect(res.body).toEqual(BIG) // supertest unzips it for us
  })

  it("sends the bytes unzipped when the client does not ask for gzip", async () => {
    const res = await request(makeApp()).get("/big").set("Accept-Encoding", "identity")

    expect(res.headers["content-encoding"]).toBeUndefined()
    expect(res.body).toEqual(BIG)
  })

  it("leaves a small body alone", async () => {
    const res = await request(makeApp()).get("/small").set("Accept-Encoding", "gzip")

    expect(res.headers["content-encoding"]).toBeUndefined()
    expect(res.body).toEqual({ ok: true })
  })

  it("leaves a 204 with no body alone", async () => {
    const res = await request(makeApp()).get("/empty").set("Accept-Encoding", "gzip")

    expect(res.status).toBe(204)
    expect(res.headers["content-encoding"]).toBeUndefined()
  })

  it("also gzips a large text body", async () => {
    const res = await request(makeApp()).get("/text").set("Accept-Encoding", "gzip")

    expect(res.headers["content-encoding"]).toBe("gzip")
    expect(res.text).toBe("x".repeat(5000))
  })
})
