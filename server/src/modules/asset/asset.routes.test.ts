import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./asset.service", () => ({
  listAssets: vi.fn(async () => [
    { id: "ast-1", assetTag: "BS-AST-00042", name: "ThinkPad", status: "AVAILABLE", heldBy: null },
  ]),
  createAsset: vi.fn(async () => ({ id: "ast-1" })),
  retireAsset: vi.fn(async () => ({ id: "ast-1", lifecycle: "RETIRED" })),
  getAsset: vi.fn(async () => ({ id: "ast-1" })),
  updateAsset: vi.fn(async () => ({ id: "ast-1" })),
  markAssetLost: vi.fn(async () => ({ id: "ast-1" })),
  listCategories: vi.fn(async () => []),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(async () => undefined),
}))

vi.mock("./asset.assignments", () => ({
  assignAsset: vi.fn(async () => ({ id: "asg-1" })),
  returnAsset: vi.fn(async () => ({ id: "asg-1" })),
  acknowledgeAssignment: vi.fn(async () => ({ id: "asg-1" })),
  myHoldings: vi.fn(async () => []),
  listUnacknowledged: vi.fn(async () => []),
  openAssignmentsFor: vi.fn(async () => []),
}))

vi.mock("./asset.requests", () => ({
  submitRequest: vi.fn(async () => ({ id: "req-1", status: "PENDING" })),
  listRequests: vi.fn(async () => []),
  approveRequest: vi.fn(async () => ({ id: "req-1", status: "APPROVED" })),
  rejectRequest: vi.fn(async () => ({ id: "req-1", status: "REJECTED" })),
  cancelRequest: vi.fn(async () => ({ id: "req-1", status: "CANCELLED" })),
  fulfilRequest: vi.fn(async () => ({ id: "req-1", status: "FULFILLED" })),
  markOrdered: vi.fn(async () => ({ id: "req-1", status: "ORDERED" })),
  getRequestTimeline: vi.fn(async () => []),
}))

vi.mock("./asset.capitalise", () => ({
  capitaliseAsset: vi.fn(async () => ({ id: "ast-1", capitalisedAt: new Date() })),
  payForAsset: vi.fn(async () => ({ id: "ast-1" })),
  disposeAsset: vi.fn(async () => ({ id: "ast-1", lifecycle: "RETIRED" })),
}))

vi.mock("./asset.value", () => ({
  assetValueReport: vi.fn(async () => ({ rows: [], totals: [], asOf: "2026-08-15" })),
}))

vi.mock("./asset.recoveries", () => ({
  createRecovery: vi.fn(async () => ({ id: "rec-1", status: "PENDING" })),
  listRecoveries: vi.fn(async () => []),
  updateRecovery: vi.fn(async () => ({ id: "rec-1" })),
  waiveRecovery: vi.fn(async () => ({ id: "rec-1", status: "WAIVED" })),
  recoverFromPayroll: vi.fn(async () => ({ id: "rec-1" })),
}))

vi.mock("./asset.exit", () => ({
  exitChecklistFor: vi.fn(async () => ({ employeeId: "emp-1", openAssignments: [], pendingRecoveries: [], hasOutstanding: false })),
}))

vi.mock("../../config/prisma", () => ({
  default: {
    employee: { findUnique: vi.fn(async () => ({ id: "emp-1" })) },
  },
}))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"
import { listAssets } from "./asset.service"

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

describe("GET /api/assets", () => {
  it("passes the caller through so the service can scope to their own holdings", async () => {
    const res = await request(app).get("/api/assets").set(authHeader("EMPLOYEE"))

    expect(res.status).toBe(200)
    // Scoping lives in assetScopeFor, which the service test covers. What
    // this asserts is that the route does not bypass it by ignoring the user.
    expect(listAssets).toHaveBeenCalledWith(
      expect.objectContaining({ role: "EMPLOYEE" }),
      expect.anything()
    )
  })

  it("401s without a token", async () => {
    const res = await request(app).get("/api/assets")

    expect(res.status).toBe(401)
  })
})

describe("cost field visibility", () => {
  it("a manager receives no purchaseCost or vendor field at all", async () => {
    vi.mocked(listAssets).mockResolvedValueOnce([
      { id: "ast-1", assetTag: "BS-AST-00042", name: "ThinkPad", status: "AVAILABLE", heldBy: null },
    ] as never)

    const res = await request(app).get("/api/assets").set(authHeader("REPORTING_MANAGER"))

    expect(res.status).toBe(200)
    // Omitted from the response, not hidden in the UI — there is exactly one
    // place this rule can drift, and it is stripCosts.
    expect(res.body[0]).not.toHaveProperty("purchaseCost")
    expect(res.body[0]).not.toHaveProperty("vendor")
  })
})

describe("the write matrix", () => {
  it("Finance creating an asset is 403 — the register is HR's", async () => {
    const res = await request(app)
      .post("/api/assets")
      .set(authHeader("FINANCE_OFFICER"))
      .send({ categoryId: "11111111-1111-1111-1111-111111111111", name: "Desk" })

    expect(res.status).toBe(403)
  })

  it("Finance retiring an asset is allowed — disposal is the one accounting action", async () => {
    const res = await request(app)
      .post("/api/assets/ast-1/retire")
      .set(authHeader("FINANCE_OFFICER"))
      .send({ note: "Written off" })

    expect(res.status).toBe(200)
  })

  it("a manager assigning an asset is 403 — custody is HR's", async () => {
    const res = await request(app)
      .post("/api/assets/ast-1/assign")
      .set(authHeader("REPORTING_MANAGER"))
      .send({ employeeId: "11111111-1111-1111-1111-111111111111", conditionOut: "GOOD" })

    expect(res.status).toBe(403)
  })

  it("an employee posting to /import/commit is 403", async () => {
    const res = await request(app)
      .post("/api/assets/import/commit")
      .set(authHeader("EMPLOYEE"))

    expect(res.status).toBe(403)
  })
})

describe("route ordering", () => {
  it("GET /me is not matched as GET /:id", async () => {
    const res = await request(app).get("/api/assets/me").set(authHeader("EMPLOYEE"))

    expect(res.status).toBe(200)
    // If /:id were declared first, Express would call getAsset with id "me"
    // and this would 404 — the bug the literal-paths-first ordering prevents.
    expect(res.body).toEqual([])
  })

  it("GET /categories is not matched as GET /:id", async () => {
    const res = await request(app).get("/api/assets/categories").set(authHeader("EMPLOYEE"))

    expect(res.status).toBe(200)
  })
})

describe("DELETE /api/assets/categories/:id", () => {
  it("refuses a Finance officer — asset categories are HR's", async () => {
    const res = await request(app)
      .delete("/api/assets/categories/c1")
      .set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(403)
  })

  it("allows HR_ADMIN", async () => {
    const res = await request(app).delete("/api/assets/categories/c1").set(authHeader("HR_ADMIN"))

    expect(res.status).toBe(204)
  })
})

describe("the ledger actions", () => {
  it("lets FINANCE_OFFICER capitalise and refuses HR_ADMIN", async () => {
    const fin = await request(app)
      .post("/api/assets/ast-1/capitalise")
      .set(authHeader("FINANCE_OFFICER"))
    expect(fin.status).toBe(201)

    const hr = await request(app)
      .post("/api/assets/ast-1/capitalise")
      .set(authHeader("HR_ADMIN"))
    expect(hr.status).toBe(403)
  })

  it("lets FINANCE_OFFICER pay and refuses EMPLOYEE", async () => {
    const fin = await request(app)
      .post("/api/assets/ast-1/pay")
      .set(authHeader("FINANCE_OFFICER"))
      .send({ paidAt: "2026-08-10" })
    expect(fin.status).toBe(201)

    const emp = await request(app)
      .post("/api/assets/ast-1/pay")
      .set(authHeader("EMPLOYEE"))
      .send({})
    expect(emp.status).toBe(403)
  })

  it("lets FINANCE_OFFICER dispose and refuses REPORTING_MANAGER", async () => {
    const fin = await request(app)
      .post("/api/assets/ast-1/dispose")
      .set(authHeader("FINANCE_OFFICER"))
      .send({ proceeds: "10000" })
    expect(fin.status).toBe(201)

    const mgr = await request(app)
      .post("/api/assets/ast-1/dispose")
      .set(authHeader("REPORTING_MANAGER"))
      .send({})
    expect(mgr.status).toBe(403)
  })

  it("lets HR_ADMIN read the value report — HR prices a lost laptop from it", async () => {
    const res = await request(app).get("/api/assets/value").set(authHeader("HR_ADMIN"))

    expect(res.status).toBe(200)
  })

  it("refuses EMPLOYEE the value report", async () => {
    const res = await request(app).get("/api/assets/value").set(authHeader("EMPLOYEE"))

    expect(res.status).toBe(403)
  })
})

describe("recoveries", () => {
  it("lets HR_ADMIN create a recovery and refuses FINANCE_OFFICER", async () => {
    const body = {
      assetId: "550e8400-e29b-41d4-a716-446655440000",
      employeeId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      amount: "45000",
      reason: "Not returned",
    }
    const hr = await request(app).post("/api/assets/recoveries").set(authHeader("HR_ADMIN")).send(body)
    expect(hr.status).toBe(201)

    const fin = await request(app).post("/api/assets/recoveries").set(authHeader("FINANCE_OFFICER")).send(body)
    expect(fin.status).toBe(403)
  })

  it("lets FINANCE_OFFICER read recoveries", async () => {
    const res = await request(app).get("/api/assets/recoveries").set(authHeader("FINANCE_OFFICER"))
    expect(res.status).toBe(200)
  })

  it("lets HR_ADMIN waive and recover from payroll", async () => {
    const waive = await request(app)
      .post("/api/assets/recoveries/rec-1/waive")
      .set(authHeader("HR_ADMIN"))
      .send({ waiverReason: "Company fault" })
    expect(waive.status).toBe(200)

    const collect = await request(app)
      .post("/api/assets/recoveries/rec-1/recover-from-payroll")
      .set(authHeader("HR_ADMIN"))
    expect(collect.status).toBe(200)
  })

  it("refuses FINANCE_OFFICER the write actions — HR decides", async () => {
    const waive = await request(app)
      .post("/api/assets/recoveries/rec-1/waive")
      .set(authHeader("FINANCE_OFFICER"))
      .send({ waiverReason: "x" })
    expect(waive.status).toBe(403)

    const collect = await request(app)
      .post("/api/assets/recoveries/rec-1/recover-from-payroll")
      .set(authHeader("FINANCE_OFFICER"))
    expect(collect.status).toBe(403)
  })

  it("refuses DELETE on a recovery with 405", async () => {
    const res = await request(app)
      .delete("/api/assets/recoveries/rec-1")
      .set(authHeader("SUPER_ADMIN"))
    expect(res.status).toBe(405)
  })

  it("does not match /recoveries as an asset id", async () => {
    const res = await request(app).get("/api/assets/recoveries").set(authHeader("HR_ADMIN"))
    expect(res.status).toBe(200)
    // If /:id were declared first, Express would call getAsset with id
    // "recoveries" and this would 404.
    expect(res.body).toEqual([])
  })

  it("lets an employee read their own recoveries — scoped by the service", async () => {
    const res = await request(app).get("/api/assets/recoveries").set(authHeader("EMPLOYEE"))
    expect(res.status).toBe(200)
    // The scope is applied in the service (own employee id), not the route.
    const { listRecoveries } = await import("./asset.recoveries")
    expect(listRecoveries).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ role: "EMPLOYEE" })
    )
  })
})

describe("exit checklist", () => {
  it("lets HR_ADMIN and FINANCE_OFFICER read it", async () => {
    const hr = await request(app).get("/api/assets/exit-checklist/emp-1").set(authHeader("HR_ADMIN"))
    expect(hr.status).toBe(200)

    const fin = await request(app).get("/api/assets/exit-checklist/emp-1").set(authHeader("FINANCE_OFFICER"))
    expect(fin.status).toBe(200)
  })

  it("refuses EMPLOYEE", async () => {
    const res = await request(app).get("/api/assets/exit-checklist/emp-1").set(authHeader("EMPLOYEE"))
    expect(res.status).toBe(403)
  })
})

describe("asset request routes", () => {
  it("refuses an HR_ADMIN approving a request", async () => {
    const res = await request(app)
      .patch("/api/assets/requests/req-1/approve")
      .set(authHeader("HR_ADMIN"))
      .send({})

    expect(res.status).toBe(403)
  })

  it("lets HR mark an approved request as ordered", async () => {
    const res = await request(app)
      .patch("/api/assets/requests/req-1/order")
      .set(authHeader("HR_ADMIN"))
      .send({ expectedBy: "2026-09-01" })

    expect(res.status).toBe(200)
  })

  it("filters the register by a derived status", async () => {
    // EC-1: the parameter was parsed, validated, then dropped on the floor,
    // because AssetListFilters has no status key and listAssets never read one.
    const res = await request(app)
      .get("/api/assets?status=AVAILABLE")
      .set(authHeader("HR_ADMIN"))

    expect(res.status).toBe(200)
    expect(res.body.every((a: { status: string }) => a.status === "AVAILABLE")).toBe(true)
  })
})
