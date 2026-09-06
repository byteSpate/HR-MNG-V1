import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./statements.pnl", async () => {
  const { assertValidRange } = await import("./statements.period")
  return {
    // The real buildPnl enforces from ≤ to via assertValidRange; the mock
    // does the same so the route test exercises that 400 over HTTP.
    buildPnl: vi.fn(async (range: unknown) => {
      assertValidRange(range as { from: Date; to: Date })
      return { lines: [], netProfit: { current: "0.00", comparative: "0.00" } }
    }),
    pnlNetProfit: vi.fn(),
  }
})

vi.mock("./statements.position", () => ({
  buildPosition: vi.fn(async () => ({ assets: [], equityAndLiabilities: [], balances: true })),
}))

vi.mock("./statements.equity", () => ({
  buildEquity: vi.fn(async () => ({ columns: [], rows: [] })),
}))

vi.mock("./statements.cashflow", () => ({
  cashFlowStatement: vi.fn(async () => ({ operating: [], investing: [], financing: [], summary: [] })),
}))

vi.mock("./statements.notes", () => ({
  statementNotes: vi.fn(async () => ({ notes: [] })),
}))

vi.mock("./statements.annexure", () => ({
  annexureA: vi.fn(async () => ({ rows: [], total: { writtenDownValue: "0.00" } })),
  assertAnnexureTiesToPosition: vi.fn(),
  positionPpe: vi.fn(() => ({ toFixed: () => "0.00" })),
}))

vi.mock("./statements.balances", () => ({ loadChart: vi.fn(async () => ({ byRole: new Map() })) }))

// Never launched. The renderer is asserted in statements.pdf.test.ts against
// its HTML; here the only question is who is allowed to ask for it.
vi.mock("./statements.pdf", () => ({
  renderStatementsPdf: vi.fn(async () => Buffer.from("%PDF-1.4 stub")),
}))

vi.mock("./statements.policy.service", () => ({
  listPolicyNotes: vi.fn(async () => []),
  createPolicyNote: vi.fn(async () => ({ id: "n1", ref: "3.00" })),
  updatePolicyNote: vi.fn(async () => ({ id: "n1", ref: "3.00" })),
  deletePolicyNote: vi.fn(async () => undefined),
}))

import app from "../../app"
import { AppError } from "../../middleware/errorHandler"
import { signAccessToken } from "../auth/auth.utils"
import { buildEquity } from "./statements.equity"
import { buildPnl } from "./statements.pnl"
import { buildPosition } from "./statements.position"

const authHeader = (role: string) => ({
  Authorization: `Bearer ${signAccessToken({
    sub: `user-${role}`,
    role: role as never,
    email: `${role}@demo.com`,
    mustChangePassword: false,
    salesRole: null,
  })}`,
})

const RANGE = "from=2024-07-01&to=2025-06-30"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("access", () => {
  it("lets a FINANCE_OFFICER read the profit or loss", async () => {
    const res = await request(app)
      .get(`/api/statements/profit-or-loss?${RANGE}`)
      .set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(200)
    expect(buildPnl).toHaveBeenCalled()
  })

  it("lets a SUPER_ADMIN read the financial position", async () => {
    const res = await request(app)
      .get(`/api/statements/financial-position?${RANGE}`)
      .set(authHeader("SUPER_ADMIN"))

    expect(res.status).toBe(200)
    expect(buildPosition).toHaveBeenCalled()
  })

  it("lets a FINANCE_OFFICER read the changes in equity", async () => {
    const res = await request(app)
      .get(`/api/statements/changes-in-equity?${RANGE}`)
      .set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(200)
    expect(buildEquity).toHaveBeenCalled()
  })

  it("403s an HR_ADMIN — the same rule as the ledger", async () => {
    const res = await request(app)
      .get(`/api/statements/profit-or-loss?${RANGE}`)
      .set(authHeader("HR_ADMIN"))

    expect(res.status).toBe(403)
    expect(buildPnl).not.toHaveBeenCalled()
  })

  it("403s a REPORTING_MANAGER", async () => {
    const res = await request(app)
      .get(`/api/statements/financial-position?${RANGE}`)
      .set(authHeader("REPORTING_MANAGER"))

    expect(res.status).toBe(403)
  })

  it("403s an EMPLOYEE", async () => {
    const res = await request(app)
      .get(`/api/statements/changes-in-equity?${RANGE}`)
      .set(authHeader("EMPLOYEE"))

    expect(res.status).toBe(403)
  })

  it("401s without a token", async () => {
    const res = await request(app).get(`/api/statements/profit-or-loss?${RANGE}`)

    expect(res.status).toBe(401)
  })
})

describe("validation", () => {
  it("coerces the dates to UTC midnight", async () => {
    await request(app)
      .get(`/api/statements/profit-or-loss?${RANGE}`)
      .set(authHeader("FINANCE_OFFICER"))

    const range = (buildPnl as any).mock.calls[0][0]
    expect(range.from.toISOString()).toBe("2024-07-01T00:00:00.000Z")
    expect(range.to.toISOString()).toBe("2025-06-30T00:00:00.000Z")
  })

  it("400s with no date range at all", async () => {
    const res = await request(app)
      .get("/api/statements/profit-or-loss")
      .set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(400)
  })

  it("400s when only one end of the range is given", async () => {
    const res = await request(app)
      .get("/api/statements/profit-or-loss?from=2024-07-01")
      .set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(400)
  })

  it("400s when the end date precedes the start", async () => {
    const res = await request(app)
      .get("/api/statements/profit-or-loss?from=2025-06-30&to=2024-07-01")
      .set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(400)
  })

  it("400s on an unparseable date", async () => {
    const res = await request(app)
      .get("/api/statements/profit-or-loss?from=last-tuesday&to=2025-06-30")
      .set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(400)
  })
})

/**
 * The 2b endpoints. The three 2a routes were covered from the start; these
 * four reads and four writes went in with no route test at all — and the
 * policy notes are this module's first writes.
 */
describe("the 2b read endpoints", () => {
  const paths = ["cash-flow", "notes", "annexure-a"]

  it.each(paths)("lets a FINANCE_OFFICER read /%s", async (path) => {
    const res = await request(app)
      .get(`/api/statements/${path}?${RANGE}`)
      .set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(200)
  })

  it.each(paths)("403s an HR_ADMIN on /%s", async (path) => {
    const res = await request(app)
      .get(`/api/statements/${path}?${RANGE}`)
      .set(authHeader("HR_ADMIN"))

    expect(res.status).toBe(403)
  })

  it.each(paths)("401s without a token on /%s", async (path) => {
    expect((await request(app).get(`/api/statements/${path}?${RANGE}`)).status).toBe(401)
  })

  it("serves the PDF as application/pdf to a SUPER_ADMIN", async () => {
    const res = await request(app)
      .get(`/api/statements/pdf?${RANGE}`)
      .set(authHeader("SUPER_ADMIN"))

    expect(res.status).toBe(200)
    expect(res.headers["content-type"]).toContain("application/pdf")
  })

  it("403s an EMPLOYEE on the PDF — it is the whole financial position", async () => {
    expect(
      (await request(app).get(`/api/statements/pdf?${RANGE}`).set(authHeader("EMPLOYEE"))).status
    ).toBe(403)
  })
})

describe("the policy-note write endpoints", () => {
  const body = { ref: "3.00", title: "Notes to the Policy", body: "Text." }

  it("lets a FINANCE_OFFICER list, create, update and delete", async () => {
    expect((await request(app).get("/api/statements/policy-notes").set(authHeader("FINANCE_OFFICER"))).status).toBe(200)
    expect((await request(app).post("/api/statements/policy-notes").set(authHeader("FINANCE_OFFICER")).send(body)).status).toBe(201)
    expect((await request(app).patch("/api/statements/policy-notes/n1").set(authHeader("FINANCE_OFFICER")).send({ body: "New." })).status).toBe(200)
    expect((await request(app).delete("/api/statements/policy-notes/n1").set(authHeader("FINANCE_OFFICER"))).status).toBe(204)
  })

  it("403s an HR_ADMIN on every one of them", async () => {
    expect((await request(app).get("/api/statements/policy-notes").set(authHeader("HR_ADMIN"))).status).toBe(403)
    expect((await request(app).post("/api/statements/policy-notes").set(authHeader("HR_ADMIN")).send(body)).status).toBe(403)
    expect((await request(app).patch("/api/statements/policy-notes/n1").set(authHeader("HR_ADMIN")).send({ body: "x" })).status).toBe(403)
    expect((await request(app).delete("/api/statements/policy-notes/n1").set(authHeader("HR_ADMIN"))).status).toBe(403)
  })

  it("401s an anonymous write", async () => {
    expect((await request(app).post("/api/statements/policy-notes").send(body)).status).toBe(401)
  })

  it("400s a create with no ref", async () => {
    const res = await request(app)
      .post("/api/statements/policy-notes")
      .set(authHeader("FINANCE_OFFICER"))
      .send({ title: "Orphan", body: "Text." })

    expect(res.status).toBe(400)
  })
})

describe("the unbalanced case", () => {
  it("passes the guard's 409 and its figures through to the client", async () => {
    ;(buildPnl as any).mockRejectedValue(
      new AppError(409, "The trial balance does not agree", {
        debitTotal: "808700.00",
        creditTotal: "800000.00",
        difference: "8700.00",
      })
    )

    const res = await request(app)
      .get(`/api/statements/profit-or-loss?${RANGE}`)
      .set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({
      error: expect.stringContaining("does not agree"),
      debitTotal: "808700.00",
      difference: "8700.00",
    })
  })
})
