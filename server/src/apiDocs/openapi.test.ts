import request from "supertest"
import { describe, expect, it } from "vitest"

import app from "../app"
import { env } from "../config/env"
import { serversFor } from "./index"

describe("api docs", () => {
  it("builds a spec from the live routes without hitting an unknown mount", async () => {
    const res = await request(app).get("/api-docs/openapi.json")

    expect(res.status).toBe(200)
    expect(res.body.openapi).toBe("3.0.3")
    expect(Object.keys(res.body.paths).length).toBeGreaterThan(100)
  })

  it("puts a nested router under its own prefix", async () => {
    const res = await request(app).get("/api-docs/openapi.json")

    expect(res.body.paths["/api/sales/funnel/cell"].patch).toBeDefined()
    expect(res.body.paths["/api/sales/funnel/meeting/{id}/note"].put.parameters[0].name).toBe("id")
  })

  it("marks protected routes and lists their roles", async () => {
    const res = await request(app).get("/api-docs/openapi.json")
    const funnel = res.body.paths["/api/sales/funnel/meeting"].post

    expect(funnel.security).toEqual([{ bearerAuth: [] }])
    expect(funnel.description).toContain("SALES_ADMIN")
    expect(res.body.paths["/api/auth/login"].post.security).toBeUndefined()
  })

  it("serves the Swagger page", async () => {
    const res = await request(app).get("/api-docs/")

    expect(res.status).toBe(200)
    expect(res.text).toContain("swagger-ui")
  })

  describe("servers dropdown", () => {
    const local = `http://localhost:${env.PORT}`

    it("lists the server the page was opened from first", () => {
      expect(serversFor(local).map((s) => s.description)).toEqual(["Local", "Deployed (Heroku)"])

      const deployed = serversFor(serversFor(local)[1].url)
      expect(deployed.map((s) => s.description)).toEqual(["Deployed (Heroku)", "Local"])
    })

    it("adds an unknown address, such as Docker on another host, ahead of the two", () => {
      const list = serversFor("http://192.168.0.5:4000")

      expect(list.map((s) => s.description)).toEqual(["This server", "Local", "Deployed (Heroku)"])
      expect(list[0].url).toBe("http://192.168.0.5:4000")
    })

    it("is in the spec the page loads", async () => {
      const res = await request(app).get("/api-docs/openapi.json")

      expect(res.body.servers).toHaveLength(3)
      expect(res.body.servers[0].description).toBe("This server")
    })
  })
})
