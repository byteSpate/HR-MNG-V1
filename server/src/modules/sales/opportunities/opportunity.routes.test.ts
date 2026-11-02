import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

// The routes now check a Permission switch before the handler. This file mocks
// the services, so the switch table gets an empty answer: every switch keeps
// its default, which is today's behaviour.
vi.mock("../../../config/prisma", () => ({
  default: { salesPermission: { findMany: vi.fn().mockResolvedValue([]) } },
}))

vi.mock("./opportunity.service", () => ({
  createOpportunity: vi.fn(), listOpportunities: vi.fn(), listOpportunityOwners: vi.fn(), getOpportunity: vi.fn(),
  updateOpportunity: vi.fn(), changeOpportunityStage: vi.fn(),
  changeOpportunityStatus: vi.fn(), changeOpportunityNextStep: vi.fn(),
  getOpportunityTimeline: vi.fn(), getOpportunityHistory: vi.fn(), beforeQuotationSummary: vi.fn(),
}))
vi.mock("./opportunity.status", () => ({ correctOpportunityStatus: vi.fn() }))
vi.mock("./opportunity.line.service", () => ({
  addOpportunityLine: vi.fn(), updateOpportunityLine: vi.fn(), deleteOpportunityLine: vi.fn(),
  reorderOpportunityLines: vi.fn(), suggestOpportunityLineValues: vi.fn(),
}))

import app from "../../../app"
import { signAccessToken } from "../../auth/auth.utils"
import * as opportunities from "./opportunity.service"
import * as lines from "./opportunity.line.service"
import * as status from "./opportunity.status"

const token = (salesRole: "SALES_USER" | "SALES_ADMIN" | null) => signAccessToken({
  sub: "user-1", role: "EMPLOYEE" as never, email: "sales@example.com",
  mustChangePassword: false, salesRole: salesRole as never,
})
const auth = (salesRole: "SALES_USER" | "SALES_ADMIN" | null) => `Bearer ${token(salesRole)}`

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(opportunities.createOpportunity).mockResolvedValue({ id: "opp-1" } as any)
  vi.mocked(opportunities.listOpportunities).mockResolvedValue({ items: [], nextCursor: null } as any)
  vi.mocked(opportunities.listOpportunityOwners).mockResolvedValue([] as any)
  vi.mocked(opportunities.getOpportunity).mockResolvedValue({ id: "opp-1" } as any)
  vi.mocked(opportunities.getOpportunityHistory).mockResolvedValue({ items: [], truncated: false, limit: 100 } as any)
  vi.mocked(opportunities.changeOpportunityStage).mockResolvedValue({ id: "opp-1" } as any)
  vi.mocked(status.correctOpportunityStatus).mockResolvedValue({ id: "opp-1" } as any)
  vi.mocked(lines.addOpportunityLine).mockResolvedValue({ id: "line-1" } as any)
  vi.mocked(lines.updateOpportunityLine).mockResolvedValue({ id: "line-1" } as any)
  vi.mocked(lines.suggestOpportunityLineValues).mockResolvedValue([])
})

describe("Before Quotation routes (owner, 2026-11-02)", () => {
  const COUNTS = { total: 4, quoteDueSoon: 1, noNextStep: 2, quiet: 0, stuck: 1 }

  it("serves the counters on their own path, never as an Opportunity id", async () => {
    vi.mocked(opportunities.beforeQuotationSummary).mockResolvedValue(COUNTS as any)
    const res = await request(app).get("/api/sales/opportunities/before-quotation/summary")
      .set("Authorization", auth("SALES_USER")).expect(200)
    expect(res.body).toEqual(COUNTS)
    expect(opportunities.getOpportunity).not.toHaveBeenCalled()
  })

  it("needs a Sales Hub sign-in", async () => {
    await request(app).get("/api/sales/opportunities/before-quotation/summary").expect(401)
    await request(app).get("/api/sales/opportunities/before-quotation/summary").set("Authorization", auth(null)).expect(403)
  })

  it("passes the owner filter on and refuses an owner that is not an id", async () => {
    vi.mocked(opportunities.beforeQuotationSummary).mockResolvedValue(COUNTS as any)
    const owner = "11111111-1111-4111-8111-111111111111"
    await request(app).get(`/api/sales/opportunities/before-quotation/summary?ownerEmployeeId=${owner}`)
      .set("Authorization", auth("SALES_ADMIN")).expect(200)
    expect(vi.mocked(opportunities.beforeQuotationSummary).mock.calls[0][0]).toMatchObject({ ownerEmployeeId: owner })
    await request(app).get("/api/sales/opportunities/before-quotation/summary?ownerEmployeeId=nope")
      .set("Authorization", auth("SALES_ADMIN")).expect(400)
  })

  it("lists the Before Quotation view and refuses another view name", async () => {
    await request(app).get("/api/sales/opportunities?view=BEFORE_QUOTATION").set("Authorization", auth("SALES_USER")).expect(200)
    expect(vi.mocked(opportunities.listOpportunities).mock.calls[0][0]).toMatchObject({ view: "BEFORE_QUOTATION" })
    await request(app).get("/api/sales/opportunities?view=EVERYTHING").set("Authorization", auth("SALES_USER")).expect(400)
  })

  it("saves an expected quote date and clears it with null", async () => {
    vi.mocked(opportunities.updateOpportunity).mockResolvedValue({ id: "opp-1" } as any)
    await request(app).patch("/api/sales/opportunities/opp-1").set("Authorization", auth("SALES_USER"))
      .send({ expectedQuoteOn: "2026-11-20" }).expect(200)
    await request(app).patch("/api/sales/opportunities/opp-1").set("Authorization", auth("SALES_USER"))
      .send({ expectedQuoteOn: null }).expect(200)
    await request(app).patch("/api/sales/opportunities/opp-1").set("Authorization", auth("SALES_USER"))
      .send({ expectedQuoteOn: "20/11/2026" }).expect(400)
    expect(vi.mocked(opportunities.updateOpportunity).mock.calls.map((c) => (c[1] as any).expectedQuoteOn)).toEqual(["2026-11-20", null])
  })
})

describe("opportunity routes", () => {
  it("guards opportunity endpoints with Sales Hub access", async () => {
    await request(app).get("/api/sales/opportunities").expect(401)
    await request(app).get("/api/sales/opportunities")
      .set("Authorization", auth(null)).expect(403)
  })

  it("creates, lists, and reads opportunities", async () => {
    await request(app).post("/api/sales/opportunities")
      .set("Authorization", auth("SALES_USER"))
      .send({
        salesAccountId: "11111111-1111-4111-8111-111111111111",
        name: "Core refresh", track: "NETWORKING",
      }).expect(201)
    await request(app).get("/api/sales/opportunities?status=ONGOING&mine=true")
      .set("Authorization", auth("SALES_USER")).expect(200)
    await request(app).get("/api/sales/opportunities/opp-1")
      .set("Authorization", auth("SALES_USER")).expect(200)
  })

  it("parses action filters and serves opportunity history", async () => {
    await request(app).get("/api/sales/opportunities?closing=30&quiet=30&stuck=21")
      .set("Authorization", auth("SALES_USER")).expect(200)
    expect(opportunities.listOpportunities).toHaveBeenLastCalledWith(
      expect.objectContaining({ closing: 30, quiet: 30, stuck: 21 }),
      expect.objectContaining({ sub: "user-1" })
    )

    await request(app).get("/api/sales/opportunities/opp-1/history")
      .set("Authorization", auth("SALES_USER")).expect(200)
    expect(opportunities.getOpportunityHistory).toHaveBeenCalledWith(
      "opp-1", expect.objectContaining({ sub: "user-1" })
    )
  })

  it("rejects an invalid stage before calling the service", async () => {
    await request(app).patch("/api/sales/opportunities/opp-1/stage")
      .set("Authorization", auth("SALES_USER"))
      .send({ stage: "SIGNED" }).expect(400)
    expect(opportunities.changeOpportunityStage).not.toHaveBeenCalled()
  })

  it("adds a line and serves scoped suggestions", async () => {
    await request(app).post("/api/sales/opportunities/opp-1/lines")
      .set("Authorization", auth("SALES_USER"))
      .send({ product: "Switch" }).expect(201)
    await request(app).get("/api/sales/suggestions/oem?field=brand&q=cis")
      .set("Authorization", auth("SALES_USER")).expect(200)
  })

  it("allows an optional line quantity to be cleared", async () => {
    await request(app).patch("/api/sales/lines/line-1")
      .set("Authorization", auth("SALES_USER"))
      .send({ quantity: null }).expect(200)
    expect(lines.updateOpportunityLine).toHaveBeenCalledWith(
      "line-1", { quantity: null }, expect.objectContaining({ sub: "user-1" })
    )
  })

  // Regression: the client sends null to clear these three, same as it does
  // for quantity above, but the schema had only been extended to accept null
  // on the price fields — oemBrand, model and note were left behind, so
  // saving an edit with any of them blank failed with a raw Zod message
  // ("oemBrand: Invalid input: expected string, received null") instead of
  // clearing the field.
  it("allows OEM brand, model and description to each be cleared", async () => {
    await request(app).patch("/api/sales/lines/line-1")
      .set("Authorization", auth("SALES_USER"))
      .send({ oemBrand: null }).expect(200)
    await request(app).patch("/api/sales/lines/line-1")
      .set("Authorization", auth("SALES_USER"))
      .send({ model: null }).expect(200)
    await request(app).patch("/api/sales/lines/line-1")
      .set("Authorization", auth("SALES_USER"))
      .send({ description: null }).expect(200)

    expect(lines.updateOpportunityLine).toHaveBeenCalledWith("line-1", { oemBrand: null }, expect.anything())
    expect(lines.updateOpportunityLine).toHaveBeenCalledWith("line-1", { model: null }, expect.anything())
    expect(lines.updateOpportunityLine).toHaveBeenCalledWith("line-1", { description: null }, expect.anything())
  })
})

describe("a product's margin", () => {
  it("accepts a margin percentage on a new product, and a loss on an edit", async () => {
    await request(app).post("/api/sales/opportunities/opp-1/lines")
      .set("Authorization", auth("SALES_USER"))
      .send({ product: "Switch", lineValue: "10000", marginPercent: "12.5" }).expect(201)
    expect(lines.addOpportunityLine).toHaveBeenCalledWith(
      "opp-1", expect.objectContaining({ marginPercent: "12.5" }), expect.anything()
    )

    await request(app).patch("/api/sales/lines/line-1")
      .set("Authorization", auth("SALES_USER"))
      .send({ marginPercent: "-5" }).expect(200)
    expect(lines.updateOpportunityLine).toHaveBeenCalledWith(
      "line-1", { marginPercent: "-5" }, expect.anything()
    )
  })

  it("lets a product's margin be cleared", async () => {
    await request(app).patch("/api/sales/lines/line-1")
      .set("Authorization", auth("SALES_USER"))
      .send({ marginPercent: null }).expect(200)
    expect(lines.updateOpportunityLine).toHaveBeenCalledWith(
      "line-1", { marginPercent: null }, expect.anything()
    )
  })

  it("rejects a margin outside -100 to 100, or with more than two decimals", async () => {
    for (const marginPercent of ["101", "-100.5", "12.345", "ten"]) {
      await request(app).post("/api/sales/opportunities/opp-1/lines")
        .set("Authorization", auth("SALES_USER"))
        .send({ product: "Switch", marginPercent }).expect(400)
    }
    expect(lines.addOpportunityLine).not.toHaveBeenCalled()
  })

  it("serves the status correction, and refuses one with no reason", async () => {
    await request(app).post("/api/sales/opportunities/opp-1/correct-status")
      .set("Authorization", auth("SALES_ADMIN"))
      .send({ status: "LOST", reason: "Wrong click" }).expect(200)
    await request(app).post("/api/sales/opportunities/opp-1/correct-status")
      .set("Authorization", auth("SALES_ADMIN"))
      .send({ status: "LOST" }).expect(400)
    expect(status.correctOpportunityStatus).toHaveBeenCalledWith(
      "opp-1", { status: "LOST", reason: "Wrong click" }, expect.objectContaining({ sub: "user-1" })
    )
  })
})
