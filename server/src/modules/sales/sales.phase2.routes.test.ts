import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./opportunities/opportunity.service", () => ({
  createOpportunity: vi.fn(), listOpportunities: vi.fn(), listOpportunityOwners: vi.fn(), getOpportunity: vi.fn(),
  updateOpportunity: vi.fn(), changeOpportunityStage: vi.fn(),
  changeOpportunityStatus: vi.fn(), changeOpportunityNextStep: vi.fn(),
  getOpportunityTimeline: vi.fn(), getOpportunityHistory: vi.fn(),
}))
vi.mock("./opportunities/opportunity.line.service", () => ({
  addOpportunityLine: vi.fn(), updateOpportunityLine: vi.fn(), deleteOpportunityLine: vi.fn(),
  reorderOpportunityLines: vi.fn(), suggestOpportunityLineValues: vi.fn(),
}))
vi.mock("./comments/comment.service", () => ({
  createSalesComment: vi.fn(), listSalesComments: vi.fn(), updateSalesComment: vi.fn(),
}))

vi.mock("./targets/target.service", () => ({
  getTargetYear: vi.fn(), setSalesTarget: vi.fn(),
}))
vi.mock("./dashboard/dashboard.service", () => ({ getSalesDashboard: vi.fn() }))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"
import * as opportunities from "./opportunities/opportunity.service"
import * as lines from "./opportunities/opportunity.line.service"
import * as comments from "./comments/comment.service"
import * as targets from "./targets/target.service"
import * as salesDashboard from "./dashboard/dashboard.service"

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
  vi.mocked(lines.addOpportunityLine).mockResolvedValue({ id: "line-1" } as any)
  vi.mocked(lines.updateOpportunityLine).mockResolvedValue({ id: "line-1" } as any)
  vi.mocked(lines.suggestOpportunityLineValues).mockResolvedValue([])
  vi.mocked(comments.createSalesComment).mockResolvedValue({ id: "comment-1" } as any)
  vi.mocked(comments.listSalesComments).mockResolvedValue({ items: [], truncated: false, limit: 100 } as any)
  vi.mocked(targets.getTargetYear).mockResolvedValue({ quarters: [] } as any)
  vi.mocked(targets.setSalesTarget).mockResolvedValue({ quarter: 1 } as any)
  vi.mocked(salesDashboard.getSalesDashboard).mockResolvedValue({ stats: [], actions: [] } as any)
})

describe("Phase 2 sales routes", () => {
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

  it("creates and lists comments but exposes no delete route", async () => {
    await request(app).post("/api/sales/comments")
      .set("Authorization", auth("SALES_USER"))
      .send({
        entity: "SALES_ACCOUNT", entityId: "11111111-1111-4111-8111-111111111111",
        kind: "GENERAL", body: "Customer asked for a revision",
      }).expect(201)
    await request(app).get(
      "/api/sales/comments?entity=SALES_ACCOUNT&entityId=11111111-1111-4111-8111-111111111111"
    ).set("Authorization", auth("SALES_USER")).expect(200)
    await request(app).delete("/api/sales/comments/comment-1")
      .set("Authorization", auth("SALES_ADMIN")).expect(404)
  })
})

describe("targets and the dashboard", () => {
  it("guards both endpoints with Sales Hub access", async () => {
    await request(app).get("/api/sales/dashboard").expect(401)
    await request(app).get("/api/sales/targets?calendarYear=2026")
      .set("Authorization", auth(null)).expect(403)
  })

  it("serves a dashboard and a target year to a Sales User", async () => {
    await request(app).get("/api/sales/dashboard")
      .set("Authorization", auth("SALES_USER")).expect(200)
    await request(app).get("/api/sales/targets?calendarYear=2026")
      .set("Authorization", auth("SALES_USER")).expect(200)
  })

  it("lets only a Sales Admin set a yearly target", async () => {
    const body = {
      employeeId: "11111111-1111-4111-8111-111111111111",
      calendarYear: 2026, amount: "4000000.00", startQuarter: 1,
    }
    await request(app).put("/api/sales/targets")
      .set("Authorization", auth("SALES_USER")).send(body).expect(403)
    expect(targets.setSalesTarget).not.toHaveBeenCalled()

    await request(app).put("/api/sales/targets")
      .set("Authorization", auth("SALES_ADMIN")).send(body).expect(200)
    expect(targets.setSalesTarget).toHaveBeenCalledWith(
      expect.objectContaining({ amount: "4000000.00", startQuarter: 1 }),
      expect.objectContaining({ sub: "user-1" })
    )
  })

  it("starts a yearly target in Q1 unless told otherwise", async () => {
    await request(app).put("/api/sales/targets")
      .set("Authorization", auth("SALES_ADMIN"))
      .send({
        employeeId: "11111111-1111-4111-8111-111111111111",
        calendarYear: 2026, amount: "4000000.00",
      })
      .expect(200)
    expect(targets.setSalesTarget).toHaveBeenCalledWith(
      expect.objectContaining({ startQuarter: 1 }),
      expect.anything()
    )
  })

  it("rejects a start quarter outside one to four before calling the service", async () => {
    await request(app).put("/api/sales/targets")
      .set("Authorization", auth("SALES_ADMIN"))
      .send({
        employeeId: "11111111-1111-4111-8111-111111111111",
        calendarYear: 2026, amount: "4000000.00", startQuarter: 5,
      })
      .expect(400)
    expect(targets.setSalesTarget).not.toHaveBeenCalled()
  })

  it("rejects a target of zero, which is not a target", async () => {
    await request(app).put("/api/sales/targets")
      .set("Authorization", auth("SALES_ADMIN"))
      .send({
        employeeId: "11111111-1111-4111-8111-111111111111",
        calendarYear: 2026, amount: "0", startQuarter: 1,
      })
      .expect(400)
    expect(targets.setSalesTarget).not.toHaveBeenCalled()
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
})
