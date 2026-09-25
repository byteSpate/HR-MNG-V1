import { describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./customerCreditNote.service", () => ({
  listCustomerCreditNotes: vi.fn(),
  getCustomerCreditNote: vi.fn(),
  createCustomerCreditNote: vi.fn(),
}))
vi.mock("./customerCreditNote.posting", () => ({ approveCustomerCreditNote: vi.fn() }))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"

function tokenFor(role: "EMPLOYEE" | "FINANCE_OFFICER" | "SUPER_ADMIN") {
  return signAccessToken({ sub: "actor-1", role: role as any, email: "a@b.com", mustChangePassword: false, salesRole: null })
}
function salesToken() {
  return signAccessToken({ sub: "actor-2", role: "EMPLOYEE" as any, email: "s@b.com", mustChangePassword: false, salesRole: "SALES_USER" as any })
}

const UUID = "8b0f1c1e-1111-4a4a-9999-000000000001"

describe("/api/customer-credit-notes", () => {
  it("401s with no token", async () => {
    expect((await request(app).get("/api/customer-credit-notes")).status).toBe(401)
  })

  it("403s an employee", async () => {
    expect((await request(app).get("/api/customer-credit-notes").set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)).status).toBe(403)
  })

  it("403s a sales user", async () => {
    expect((await request(app).get("/api/customer-credit-notes").set("Authorization", `Bearer ${salesToken()}`)).status).toBe(403)
  })

  it("403s Finance approving: approval is Super Admin only", async () => {
    expect((await request(app).post("/api/customer-credit-notes/cn1/approve").set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)).status).toBe(403)
  })

  it("400s a note with an empty reason", async () => {
    const res = await request(app)
      .post("/api/customer-credit-notes")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
      .send({ invoiceId: UUID, date: "2026-09-23", reason: " ", lines: [{ invoiceLineId: UUID, amount: "1" }] })
    expect(res.status).toBe(400)
  })
})
