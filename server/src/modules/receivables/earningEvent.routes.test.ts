import { describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./earningEvent.service", () => ({
  listEarningEvents: vi.fn(),
  getEarningEvent: vi.fn(),
  createEarningEvent: vi.fn(),
}))
vi.mock("./earningEvent.posting", () => ({ approveEarningEvent: vi.fn() }))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"
import { createEarningEvent, listEarningEvents } from "./earningEvent.service"
import { approveEarningEvent } from "./earningEvent.posting"

function tokenFor(role: "EMPLOYEE" | "FINANCE_OFFICER" | "SUPER_ADMIN") {
  return signAccessToken({ sub: "actor-1", role: role as any, email: "a@b.com", mustChangePassword: false, salesRole: null })
}
function salesToken() {
  return signAccessToken({ sub: "actor-2", role: "EMPLOYEE" as any, email: "s@b.com", mustChangePassword: false, salesRole: "SALES_USER" as any })
}

const VALID_BODY = {
  poId: "8b0f1c1e-1111-4a4a-9999-000000000001",
  kind: "DELIVERY",
  date: "2026-09-23",
  evidenceRef: "CH-118",
  lines: [{ poLineId: "8b0f1c1e-1111-4a4a-9999-000000000002", quantity: "4" }],
}

describe("/api/earning-events", () => {
  it("401s with no token", async () => {
    expect((await request(app).get("/api/earning-events")).status).toBe(401)
  })

  it("403s an employee with no sales role, before the service runs", async () => {
    const res = await request(app).post("/api/earning-events").set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`).send(VALID_BODY)
    expect(res.status).toBe(403)
    expect(createEarningEvent).not.toHaveBeenCalled()
  })

  it("lets a sales user through to the service", async () => {
    vi.mocked(createEarningEvent).mockResolvedValue({ id: "ev1" } as any)
    const res = await request(app).post("/api/earning-events").set("Authorization", `Bearer ${salesToken()}`).send(VALID_BODY)
    expect(res.status).toBe(201)
  })

  it("400s a delivery with an empty evidence reference", async () => {
    const res = await request(app)
      .post("/api/earning-events")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
      .send({ ...VALID_BODY, evidenceRef: "" })
    expect(res.status).toBe(400)
  })

  it("403s Finance approving, only a Super Admin may", async () => {
    const res = await request(app).post("/api/earning-events/ev1/approve").set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(403)
    expect(approveEarningEvent).not.toHaveBeenCalled()
  })

  it("lets a Super Admin approve", async () => {
    vi.mocked(approveEarningEvent).mockResolvedValue({ id: "ev1" } as any)
    const res = await request(app).post("/api/earning-events/ev1/approve").set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)
    expect(res.status).toBe(200)
  })

  it("reaches the list handler for Finance", async () => {
    vi.mocked(listEarningEvents).mockResolvedValue([])
    const res = await request(app).get("/api/earning-events").set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(200)
  })
})
