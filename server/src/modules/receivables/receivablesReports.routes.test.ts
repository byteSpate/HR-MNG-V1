import { describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./receivables.reports", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./receivables.reports")>()),
  getCustomerAgeing: vi.fn(),
  getCustomerControlTieOut: vi.fn(),
}))
vi.mock("./receivables.statement", () => ({
  getCustomerStatement: vi.fn(),
  renderCustomerStatementPdf: vi.fn(),
}))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"
import { getCustomerAgeing, getCustomerControlTieOut } from "./receivables.reports"
import { getCustomerStatement, renderCustomerStatementPdf } from "./receivables.statement"

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

describe("/api/receivables/customers/:id/statement", () => {
  it("401s with no token", async () => {
    expect((await request(app).get("/api/receivables/customers/c1/statement?from=2026-09-01&to=2026-09-30")).status).toBe(401)
  })

  it("400s a from date after the to date", async () => {
    const res = await request(app)
      .get("/api/receivables/customers/c1/statement?from=2026-09-30&to=2026-09-01")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(400)
    expect(getCustomerStatement).not.toHaveBeenCalled()
  })

  it("returns the statement as JSON", async () => {
    vi.mocked(getCustomerStatement).mockResolvedValue({
      customer: { legalName: "Bengal Group", billingAddress: null, bin: null },
      from: new Date("2026-09-01"), to: new Date("2026-09-30"), openingBalance: "0.00", entries: [], closingBalance: "0.00",
    })
    const res = await request(app)
      .get("/api/receivables/customers/c1/statement?from=2026-09-01&to=2026-09-30")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(200)
    expect(getCustomerStatement).toHaveBeenCalledWith("c1", { from: new Date("2026-09-01"), to: new Date("2026-09-30") })
  })

  it("streams the statement as a PDF, with a filename", async () => {
    vi.mocked(renderCustomerStatementPdf).mockResolvedValue(Buffer.from("%PDF-fake"))
    const res = await request(app)
      .get("/api/receivables/customers/c1/statement.pdf?from=2026-09-01&to=2026-09-30")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(200)
    expect(res.headers["content-type"]).toBe("application/pdf")
    expect(res.headers["content-disposition"]).toContain("attachment")
  })
})
