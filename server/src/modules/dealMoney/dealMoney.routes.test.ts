import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./dealMoney.service", () => ({ getDealMoney: vi.fn() }))
vi.mock("./dealMoney.list", () => ({ listDealMoney: vi.fn() }))
vi.mock("./dealMoney.approvals", () => ({ listWaitingForApproval: vi.fn() }))
vi.mock("./dealMoney.sendBack", () => ({ sendBack: vi.fn() }))
vi.mock("./dealMoney.vatSummary", () => ({ getVatSummary: vi.fn() }))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"
import { getDealMoney } from "./dealMoney.service"
import { listDealMoney } from "./dealMoney.list"
import { listWaitingForApproval } from "./dealMoney.approvals"
import { sendBack } from "./dealMoney.sendBack"
import { getVatSummary } from "./dealMoney.vatSummary"

function tokenFor(role: "EMPLOYEE" | "FINANCE_OFFICER" | "SUPER_ADMIN") {
  return signAccessToken({ sub: "u1", role: role as any, email: "u1@b.co", mustChangePassword: false, salesRole: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listDealMoney).mockResolvedValue({ rows: [], total: 0 })
  vi.mocked(getDealMoney).mockResolvedValue({} as any)
  vi.mocked(listWaitingForApproval).mockResolvedValue([])
  vi.mocked(sendBack).mockResolvedValue(undefined)
  vi.mocked(getVatSummary).mockResolvedValue({ onInvoices: "0.00", onBills: "0.00", difference: "0.00", withheldByCustomers: "0.00" })
})

describe("GET /api/deal-money/deals", () => {
  it("401s with no token", async () => {
    expect((await request(app).get("/api/deal-money/deals")).status).toBe(401)
  })
  it("403s an employee", async () => {
    expect((await request(app).get("/api/deal-money/deals").set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)).status).toBe(403)
  })
  it("200s for Finance", async () => {
    expect((await request(app).get("/api/deal-money/deals").set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)).status).toBe(200)
  })
})

describe("GET /api/deal-money/deals/:opportunityId", () => {
  it("401s with no token", async () => {
    expect((await request(app).get("/api/deal-money/deals/opp-1")).status).toBe(401)
  })
  it("lets any signed-in role through to the service", async () => {
    expect((await request(app).get("/api/deal-money/deals/opp-1").set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)).status).toBe(200)
  })
})

describe("GET /api/deal-money/approvals", () => {
  it("401s with no token", async () => {
    expect((await request(app).get("/api/deal-money/approvals")).status).toBe(401)
  })
  it("403s an employee", async () => {
    expect((await request(app).get("/api/deal-money/approvals").set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)).status).toBe(403)
  })
  it("200s for Finance", async () => {
    expect((await request(app).get("/api/deal-money/approvals").set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)).status).toBe(200)
  })
})

describe("POST /api/deal-money/approvals/:kind/:id/send-back", () => {
  it("401s with no token", async () => {
    expect((await request(app).post("/api/deal-money/approvals/INVOICE/inv-1/send-back").send({ note: "x" })).status).toBe(401)
  })
  it("403s Finance: send-back is Super Admin only", async () => {
    const res = await request(app)
      .post("/api/deal-money/approvals/INVOICE/inv-1/send-back")
      .send({ note: "x" })
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(403)
  })
  it("400s an unknown document type", async () => {
    const res = await request(app)
      .post("/api/deal-money/approvals/NOT_A_KIND/inv-1/send-back")
      .send({ note: "x" })
      .set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("This kind of document cannot be sent back.")
    expect(sendBack).not.toHaveBeenCalled()
  })

  it.each(["CUSTOMER_CREDIT_NOTE", "SUPPLIER_CREDIT_NOTE"])(
    "400s %s: credit notes cannot be sent back, refused before the service runs",
    async (kind) => {
      const res = await request(app)
        .post(`/api/deal-money/approvals/${kind}/cn-1/send-back`)
        .send({ note: "x" })
        .set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)
      expect(res.status).toBe(400)
      expect(res.body.error).toBe(
        "Credit notes cannot be sent back yet. Talk to whoever recorded it, so it can be fixed before you approve it."
      )
      expect(sendBack).not.toHaveBeenCalled()
    }
  )
  it("204s a valid send-back", async () => {
    const res = await request(app)
      .post("/api/deal-money/approvals/INVOICE/inv-1/send-back")
      .send({ note: "Wrong invoice number" })
      .set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)
    expect(res.status).toBe(204)
    expect(sendBack).toHaveBeenCalledWith("INVOICE", "inv-1", { note: "Wrong invoice number" }, expect.objectContaining({ sub: "u1" }))
  })
})

describe("GET /api/deal-money/vat-summary", () => {
  it("401s with no token", async () => {
    expect((await request(app).get("/api/deal-money/vat-summary?from=2026-11-01&to=2026-11-30")).status).toBe(401)
  })
  it("403s an employee", async () => {
    const res = await request(app)
      .get("/api/deal-money/vat-summary?from=2026-11-01&to=2026-11-30")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(res.status).toBe(403)
  })
  it("400s a period that ends before it starts", async () => {
    const res = await request(app)
      .get("/api/deal-money/vat-summary?from=2026-11-30&to=2026-11-01")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(400)
    expect(res.body.error).toContain("The end date is before the start date.")
  })
  it("200s a valid period", async () => {
    const res = await request(app)
      .get("/api/deal-money/vat-summary?from=2026-11-01&to=2026-11-30")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(200)
  })
})
