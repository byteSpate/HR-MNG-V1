import { describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./customerPo.service", () => ({
  listCustomerPos: vi.fn(),
  getCustomerPo: vi.fn(),
  prefillPoLines: vi.fn(),
  createCustomerPo: vi.fn(),
  updateCustomerPo: vi.fn(),
  cancelCustomerPo: vi.fn(),
}))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"
import { createCustomerPo, getCustomerPo, prefillPoLines } from "./customerPo.service"

function tokenFor(role: "EMPLOYEE" | "FINANCE_OFFICER" | "SUPER_ADMIN") {
  return signAccessToken({ sub: "actor-1", role: role as any, email: "a@b.com", mustChangePassword: false, salesRole: null })
}
function salesToken() {
  return signAccessToken({ sub: "actor-2", role: "EMPLOYEE" as any, email: "s@b.com", mustChangePassword: false, salesRole: "SALES_USER" as any })
}

const VALID_BODY = {
  opportunityId: "8b0f1c1e-1111-4a4a-9999-000000000001",
  customerPoNumber: "PO-778",
  date: "2026-09-23",
  lines: [{ description: "Firewall", kind: "GOODS", quantity: "10", unitPrice: "80000", vatCodeId: "8b0f1c1e-1111-4a4a-9999-000000000002" }],
}

describe("/api/customer-pos", () => {
  it("401s with no token", async () => {
    expect((await request(app).get("/api/customer-pos")).status).toBe(401)
  })

  it("403s an employee with no sales role, before the service runs", async () => {
    const res = await request(app).post("/api/customer-pos").set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`).send(VALID_BODY)
    expect(res.status).toBe(403)
    expect(createCustomerPo).not.toHaveBeenCalled()
  })

  it("lets a sales user through to the service", async () => {
    vi.mocked(createCustomerPo).mockResolvedValue({ id: "po1" } as any)
    const res = await request(app).post("/api/customer-pos").set("Authorization", `Bearer ${salesToken()}`).send(VALID_BODY)
    expect(res.status).toBe(201)
  })

  it("400s a PO with no lines", async () => {
    const res = await request(app)
      .post("/api/customer-pos")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
      .send({ ...VALID_BODY, lines: [] })
    expect(res.status).toBe(400)
  })

  it("routes /prefill/:opportunityId to the prefill, not to a PO called 'prefill'", async () => {
    vi.mocked(prefillPoLines).mockResolvedValue({ lines: [] })
    const res = await request(app).get("/api/customer-pos/prefill/opp-1").set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(200)
    expect(prefillPoLines).toHaveBeenCalledWith("opp-1", expect.anything())
    expect(getCustomerPo).not.toHaveBeenCalled()
  })
})
