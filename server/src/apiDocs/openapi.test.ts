import request from "supertest"
import { describe, expect, it } from "vitest"

import app from "../app"

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
})
