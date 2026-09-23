import { describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./receivables.reports", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./receivables.reports")>()),
  getCustomerAgeing: vi.fn(),
  getCustomerControlTieOut: vi.fn(),
}))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"
import { getCustomerAgeing, getCustomerControlTieOut } from "./receivables.reports"

function tokenFor(role: "EMPLOYEE" | "FINANCE_OFFICER" | "SUPER_ADMIN") {
  return signAccessToken({ sub: "actor-1", role: role as any, email: "a@b.com", mustChangePassword: false, salesRole: null })
}

describe("/api/receivables/reports", () => {
  it("401s with no token", async () => {
    expect((await request(app).get("/api/receivables/reports/ageing")).status).toBe(401)
  })

  it("403s an employee", async () => {
    expect((await request(app).get("/api/receivables/reports/ageing").set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)).status).toBe(403)
  })

  it("returns the ageing report to Finance", async () => {
    vi.mocked(getCustomerAgeing).mockResolvedValue([])
    const res = await request(app).get("/api/receivables/reports/ageing").set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it("returns the tie-out to Finance", async () => {
    vi.mocked(getCustomerControlTieOut).mockResolvedValue({ subledgerTotal: "0.00", glBalance: "0.00", ties: true, advancesHeld: "0.00" })
    const res = await request(app).get("/api/receivables/reports/tie-out").set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(200)
  })
})
