import { describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./receipt.service", () => ({
  listReceipts: vi.fn(),
  getReceipt: vi.fn(),
  createReceipt: vi.fn(),
  updateReceiptCertificates: vi.fn(),
}))
vi.mock("./receipt.posting", () => ({ approveReceipt: vi.fn() }))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"
import { listReceipts } from "./receipt.service"

function tokenFor(role: "EMPLOYEE" | "FINANCE_OFFICER" | "SUPER_ADMIN") {
  return signAccessToken({ sub: "actor-1", role: role as any, email: "a@b.com", mustChangePassword: false, salesRole: null })
}

describe("/api/receipts", () => {
  it("401s with no token", async () => {
    expect((await request(app).get("/api/receipts")).status).toBe(401)
  })

  it("403s an employee reading receipts", async () => {
    expect((await request(app).get("/api/receipts").set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)).status).toBe(403)
  })

  it("403s Finance approving: approval is Super Admin only", async () => {
    expect((await request(app).post("/api/receipts/r1/approve").set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)).status).toBe(403)
  })

  it("passes the certificates filter through to the service", async () => {
    vi.mocked(listReceipts).mockResolvedValue([])
    const res = await request(app).get("/api/receipts?certificates=missing").set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(200)
    expect(listReceipts).toHaveBeenCalledWith({ status: undefined, certificates: "missing" })
  })

  it("400s an unknown certificates filter value", async () => {
    const res = await request(app).get("/api/receipts?certificates=anything-else").set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(400)
  })
})
