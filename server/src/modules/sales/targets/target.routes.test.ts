import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./target.service", () => ({
  getTargetYear: vi.fn(), setSalesTarget: vi.fn(),
}))
vi.mock("../dashboard/dashboard.service", () => ({ getSalesDashboard: vi.fn() }))

import app from "../../../app"
import { signAccessToken } from "../../auth/auth.utils"
import * as targets from "./target.service"
import * as salesDashboard from "../dashboard/dashboard.service"

const token = (salesRole: "SALES_USER" | "SALES_ADMIN" | null) => signAccessToken({
  sub: "user-1", role: "EMPLOYEE" as never, email: "sales@example.com",
  mustChangePassword: false, salesRole: salesRole as never,
})
const auth = (salesRole: "SALES_USER" | "SALES_ADMIN" | null) => `Bearer ${token(salesRole)}`

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(targets.getTargetYear).mockResolvedValue({ quarters: [] } as any)
  vi.mocked(targets.setSalesTarget).mockResolvedValue({ quarter: 1 } as any)
  vi.mocked(salesDashboard.getSalesDashboard).mockResolvedValue({ stats: [], actions: [] } as any)
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
