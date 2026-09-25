import { describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./invoice.service", () => ({
  INVOICE_INCLUDE: {},
  listInvoices: vi.fn(),
  getInvoice: vi.fn(),
  listInvoiceablePos: vi.fn(),
  createInvoice: vi.fn(),
  updateInvoice: vi.fn(),
}))
vi.mock("./invoice.posting", () => ({ approveInvoice: vi.fn() }))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"
import { getInvoice, listInvoiceablePos } from "./invoice.service"

function tokenFor(role: "EMPLOYEE" | "FINANCE_OFFICER" | "SUPER_ADMIN") {
  return signAccessToken({ sub: "actor-1", role: role as any, email: "a@b.com", mustChangePassword: false, salesRole: null })
}
function salesToken() {
  return signAccessToken({ sub: "actor-2", role: "EMPLOYEE" as any, email: "s@b.com", mustChangePassword: false, salesRole: "SALES_USER" as any })
}

const UUID = "8b0f1c1e-1111-4a4a-9999-000000000001"

describe("/api/invoices", () => {
  it("401s with no token", async () => {
    expect((await request(app).get("/api/invoices")).status).toBe(401)
  })

  it("403s an employee reading invoices", async () => {
    expect((await request(app).get("/api/invoices").set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)).status).toBe(403)
  })

  it("403s a sales user: invoices are Finance's", async () => {
    expect((await request(app).get("/api/invoices").set("Authorization", `Bearer ${salesToken()}`)).status).toBe(403)
  })

  it("403s Finance approving: approval is Super Admin only", async () => {
    expect((await request(app).post("/api/invoices/inv1/approve").set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)).status).toBe(403)
  })

  it("routes /pos to the invoiceable POs, not an invoice called 'pos'", async () => {
    vi.mocked(listInvoiceablePos).mockResolvedValue([])
    const res = await request(app).get("/api/invoices/pos").set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(200)
    expect(getInvoice).not.toHaveBeenCalled()
  })

  it("400s an invoice with no invoice number", async () => {
    const res = await request(app)
      .post("/api/invoices")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
      .send({ poId: UUID, invoiceNumber: " ", date: "2026-09-23", lines: [{ poLineId: UUID, amount: "1" }] })
    expect(res.status).toBe(400)
  })
})
