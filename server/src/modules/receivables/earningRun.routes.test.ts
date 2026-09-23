import { describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./earningRun.service", () => ({
  listEarningRuns: vi.fn(),
  draftEarningRun: vi.fn(),
  getEarningRun: vi.fn(),
  postEarningRun: vi.fn(),
  reverseEarningRun: vi.fn(),
  deleteEarningRun: vi.fn(),
}))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"
import { draftEarningRun, postEarningRun } from "./earningRun.service"

function tokenFor(role: "EMPLOYEE" | "FINANCE_OFFICER" | "SUPER_ADMIN") {
  return signAccessToken({ sub: "actor-1", role: role as any, email: "a@b.com", mustChangePassword: false, salesRole: null })
}
function salesToken() {
  return signAccessToken({ sub: "actor-2", role: "EMPLOYEE" as any, email: "s@b.com", mustChangePassword: false, salesRole: "SALES_USER" as any })
}

describe("/api/earning-runs", () => {
  it("401s with no token", async () => {
    expect((await request(app).get("/api/earning-runs")).status).toBe(401)
  })

  it("403s an employee", async () => {
    const res = await request(app).post("/api/earning-runs").set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`).send({ year: 2026, month: 9 })
    expect(res.status).toBe(403)
    expect(draftEarningRun).not.toHaveBeenCalled()
  })

  it("403s a sales user: this is a ledger action, not a Sales Hub one", async () => {
    const res = await request(app).post("/api/earning-runs").set("Authorization", `Bearer ${salesToken()}`).send({ year: 2026, month: 9 })
    expect(res.status).toBe(403)
    expect(draftEarningRun).not.toHaveBeenCalled()
  })

  it("400s for month 13", async () => {
    const res = await request(app).post("/api/earning-runs").set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`).send({ year: 2026, month: 13 })
    expect(res.status).toBe(400)
    expect(draftEarningRun).not.toHaveBeenCalled()
  })

  it("lets Finance draft a run", async () => {
    vi.mocked(draftEarningRun).mockResolvedValue({ id: "run-1" } as any)
    const res = await request(app).post("/api/earning-runs").set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`).send({ year: 2026, month: 9 })
    expect(res.status).toBe(201)
  })

  it("lets a Super Admin post a run", async () => {
    vi.mocked(postEarningRun).mockResolvedValue({ id: "run-1" } as any)
    const res = await request(app).post("/api/earning-runs/run-1/post").set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)
    expect(res.status).toBe(200)
  })
})
