import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./depreciation.service", () => ({
  draftRun: vi.fn(async () => ({ id: "run-1", runNo: "BS-DEP-00007", status: "DRAFT" })),
  listRuns: vi.fn(async () => [{ id: "run-1" }]),
  getRun: vi.fn(async () => ({ id: "run-1", runNo: "BS-DEP-00007", status: "DRAFT" })),
  postRun: vi.fn(async () => ({ id: "run-1", status: "POSTED" })),
  reverseRun: vi.fn(async () => ({ id: "run-1", status: "REVERSED" })),
  deleteRun: vi.fn(async () => undefined),
}))

vi.mock("./depreciation.preflight", () => ({
  depreciationPreflight: vi.fn(async () => ({ blockers: [], warnings: [], ok: true })),
}))

import app from "../../app"
import { AppError } from "../../middleware/errorHandler"
import { signAccessToken } from "../auth/auth.utils"

/** A bearer token for the given role, so requireRole sees a real claim. */
const authHeader = (role: string) => ({
  Authorization: `Bearer ${signAccessToken({
    sub: `user-${role}`,
    role: role as never,
    email: `${role}@demo.com`,
    mustChangePassword: false,
    salesRole: null,
  })}`,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/depreciation/preflight", () => {
  it("lets FINANCE_OFFICER read it", async () => {
    const res = await request(app)
      .get("/api/depreciation/preflight?year=2026&month=7")
      .set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(200)
  })

  it("refuses HR_ADMIN — HR reads the value report, not the ledger", async () => {
    const res = await request(app)
      .get("/api/depreciation/preflight?year=2026&month=7")
      .set(authHeader("HR_ADMIN"))

    expect(res.status).toBe(403)
  })
})

describe("POST /api/depreciation", () => {
  it("lets FINANCE_OFFICER draft a run", async () => {
    const res = await request(app)
      .post("/api/depreciation")
      .set(authHeader("FINANCE_OFFICER"))
      .send({ year: 2026, month: 7 })

    expect(res.status).toBe(201)
  })

  it("refuses EMPLOYEE everywhere on /api/depreciation", async () => {
    const res = await request(app)
      .post("/api/depreciation")
      .set(authHeader("EMPLOYEE"))
      .send({ year: 2026, month: 7 })

    expect(res.status).toBe(403)
  })
})

describe("POST /api/depreciation/:id/post", () => {
  it("lets SUPER_ADMIN post a run", async () => {
    const res = await request(app)
      .post("/api/depreciation/run-1/post")
      .set(authHeader("SUPER_ADMIN"))

    expect(res.status).toBe(200)
  })
})

describe("GET /api/depreciation/:id", () => {
  it("404s an unknown run id rather than 500ing", async () => {
    vi.mocked(await import("./depreciation.service")).getRun.mockRejectedValueOnce(
      new AppError(404, "Depreciation run not found")
    )

    const res = await request(app)
      .get("/api/depreciation/nope")
      .set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(404)
  })
})

describe("DELETE /api/depreciation/:id", () => {
  it("lets FINANCE_OFFICER delete a DRAFT", async () => {
    const res = await request(app)
      .delete("/api/depreciation/run-1")
      .set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(204)
  })
})
