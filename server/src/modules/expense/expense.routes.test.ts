import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./expense.service", () => ({
  createClaim: vi.fn(),
  getMyClaims: vi.fn(),
  listClaims: vi.fn(),
  getClaim: vi.fn(),
  approveClaim: vi.fn(),
  approveClaims: vi.fn(),
  rejectClaim: vi.fn(),
}))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"
import * as service from "./expense.service"

type TestRole = "EMPLOYEE" | "REPORTING_MANAGER" | "HR_ADMIN" | "SUPER_ADMIN" | "FINANCE_OFFICER"
const auth = (role: TestRole) =>
  `Bearer ${signAccessToken({ sub: "user-1", role: role as never, email: "a@demo.com", mustChangePassword: false })}`

const validBody = { name: "Water jar", amount: 1200, categoryId: "11111111-1111-4111-8111-111111111111", currency: "BDT", expenseDate: "2026-08-03" }

beforeEach(() => {
  vi.mocked(service.createClaim).mockResolvedValue({ id: "claim-1" } as never)
  vi.mocked(service.getMyClaims).mockResolvedValue([])
  vi.mocked(service.listClaims).mockResolvedValue([])
  vi.mocked(service.approveClaim).mockResolvedValue({ id: "claim-1" } as never)
  vi.mocked(service.approveClaims).mockResolvedValue({ approved: ["claim-1"], failed: [] } as never)
  vi.mocked(service.rejectClaim).mockResolvedValue({ id: "claim-1" } as never)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("POST /api/expenses", () => {
  it("401s unauthenticated", async () => {
    expect((await request(app).post("/api/expenses").send(validBody)).status).toBe(401)
  })

  it.each<TestRole>(["EMPLOYEE", "REPORTING_MANAGER"])("201s for %s", async (role) => {
    const res = await request(app).post("/api/expenses").set("Authorization", auth(role)).send(validBody)
    expect(res.status).toBe(201)
  })

  it("403s an administrative role with no employee profile", async () => {
    const res = await request(app).post("/api/expenses").set("Authorization", auth("HR_ADMIN")).send(validBody)
    expect(res.status).toBe(403)
  })

  it("400s a malformed body", async () => {
    const res = await request(app)
      .post("/api/expenses")
      .set("Authorization", auth("EMPLOYEE"))
      .send({ ...validBody, amount: -5 })
    expect(res.status).toBe(400)
  })
})

describe("GET /api/expenses/me", () => {
  it("routes to the self handler, not to /:id", async () => {
    await request(app).get("/api/expenses/me").set("Authorization", auth("EMPLOYEE"))
    expect(service.getMyClaims).toHaveBeenCalled()
    expect(service.getClaim).not.toHaveBeenCalled()
  })
})

describe("GET /api/expenses/categories", () => {
  it("allows staff to load categories for claim submission", async () => {
    const res = await request(app).get("/api/expenses/categories").set("Authorization", auth("EMPLOYEE"))
    expect(res.status).not.toBe(403)
  })
})

describe("review routes", () => {
  it.each<TestRole>(["EMPLOYEE", "REPORTING_MANAGER", "HR_ADMIN"])(
    "403s %s approving — Finance reviews expenses",
    async (role) => {
      const res = await request(app)
        .patch("/api/expenses/claim-1/approve")
        .set("Authorization", auth(role))
        .send({})
      expect(res.status).toBe(403)
    }
  )

  it.each<TestRole>(["FINANCE_OFFICER", "SUPER_ADMIN"])("200s for %s approving", async (role) => {
    const res = await request(app)
      .patch("/api/expenses/claim-1/approve")
      .set("Authorization", auth(role))
      .send({})
    expect(res.status).toBe(200)
  })

  it("400s a reject with no note", async () => {
    const res = await request(app)
      .patch("/api/expenses/claim-1/reject")
      .set("Authorization", auth("FINANCE_OFFICER"))
      .send({})
    expect(res.status).toBe(400)
  })

  it("has no route that sets REIMBURSED by hand", async () => {
    // A status the system reaches when a run is disbursed or a settlement
    // paid, never one a human types.
    const res = await request(app)
      .patch("/api/expenses/claim-1/reimburse")
      .set("Authorization", auth("FINANCE_OFFICER"))
      .send({})
    expect(res.status).toBe(404)
  })
})

describe("POST /api/expenses/batch-approve", () => {
  const ID = "11111111-1111-4111-8111-111111111111"

  it("401s unauthenticated", async () => {
    const res = await request(app).post("/api/expenses/batch-approve").send({ claimIds: [ID] })
    expect(res.status).toBe(401)
  })

  it.each<TestRole>(["EMPLOYEE", "REPORTING_MANAGER", "HR_ADMIN"])(
    "403s %s — approving is Finance's, in bulk as much as one at a time",
    async (role) => {
      const res = await request(app)
        .post("/api/expenses/batch-approve")
        .set("Authorization", auth(role))
        .send({ claimIds: [ID] })
      expect(res.status).toBe(403)
    }
  )

  it("200s for FINANCE_OFFICER", async () => {
    const res = await request(app)
      .post("/api/expenses/batch-approve")
      .set("Authorization", auth("FINANCE_OFFICER"))
      .send({ claimIds: [ID] })
    expect(res.status).toBe(200)
    expect(service.approveClaims).toHaveBeenCalledWith([ID], "user-1")
  })

  /**
   * A batch that approved some and refused others did not fail. A 4xx would
   * make the client throw away a result describing real approvals.
   */
  it("200s even when every claim in the sweep was refused", async () => {
    vi.mocked(service.approveClaims).mockResolvedValue({
      approved: [],
      failed: [{ id: ID, reason: "This claim is already approved" }],
    } as never)

    const res = await request(app)
      .post("/api/expenses/batch-approve")
      .set("Authorization", auth("FINANCE_OFFICER"))
      .send({ claimIds: [ID] })

    expect(res.status).toBe(200)
    expect(res.body.failed).toHaveLength(1)
  })

  it("400s an empty selection", async () => {
    const res = await request(app)
      .post("/api/expenses/batch-approve")
      .set("Authorization", auth("FINANCE_OFFICER"))
      .send({ claimIds: [] })
    expect(res.status).toBe(400)
  })

  // There is deliberately no batch reject — see docs/adr/0004.
  it("has no batch-reject route", async () => {
    const res = await request(app)
      .post("/api/expenses/batch-reject")
      .set("Authorization", auth("FINANCE_OFFICER"))
      .send({ claimIds: [ID], note: "No receipts" })
    expect(res.status).toBe(404)
  })
})
