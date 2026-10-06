import { describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./receipt.service", () => ({
  listReceipts: vi.fn(),
  getReceipt: vi.fn(),
  createReceipt: vi.fn(),
  updateReceiptCertificates: vi.fn(),
}))
vi.mock("./receipt.posting", () => ({ reverseReceipt: vi.fn() }))
vi.mock("./receipt.pdf", () => ({ renderReceiptPdf: vi.fn() }))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"
import { listReceipts } from "./receipt.service"
import { reverseReceipt } from "./receipt.posting"
import { renderReceiptPdf } from "./receipt.pdf"

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

  it("no longer has an /approve route: a receipt posts and is saved approved on creation", async () => {
    expect((await request(app).post("/api/receipts/r1/approve").set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)).status).toBe(404)
  })

  it("403s Finance reversing: reversal is Super Admin only", async () => {
    expect((await request(app).post("/api/receipts/r1/reverse").send({ reason: "x" }).set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)).status).toBe(403)
  })

  it("lets a Super Admin reverse a receipt with a reason", async () => {
    vi.mocked(reverseReceipt).mockResolvedValue({ id: "r1", status: "REVERSED" } as any)
    const res = await request(app).post("/api/receipts/r1/reverse").send({ reason: "Typed the wrong amount" }).set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)
    expect(res.status).toBe(200)
    expect(reverseReceipt).toHaveBeenCalledWith("r1", { reason: "Typed the wrong amount" }, expect.objectContaining({ sub: "actor-1" }))
  })

  it("400s a reversal with no reason", async () => {
    const res = await request(app).post("/api/receipts/r1/reverse").send({}).set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)
    expect(res.status).toBe(400)
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

describe("GET /api/receipts/:id/pdf", () => {
  it("401s with no token", async () => {
    expect((await request(app).get("/api/receipts/r1/pdf")).status).toBe(401)
  })

  it("sends the PDF as a download named after the receipt number", async () => {
    vi.mocked(renderReceiptPdf).mockResolvedValue({ pdf: Buffer.from("%PDF-1.4"), number: "MR-0001" })

    const res = await request(app).get("/api/receipts/r1/pdf").set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)

    expect(res.status).toBe(200)
    expect(res.headers["content-type"]).toContain("application/pdf")
    expect(res.headers["content-disposition"]).toBe('attachment; filename="MR-0001.pdf"')
    expect(renderReceiptPdf).toHaveBeenCalledWith("r1", expect.objectContaining({ sub: "actor-1", role: "FINANCE_OFFICER" }))
  })

  it("is open to any signed-in user at the route, because the service checks access to the Opportunity", async () => {
    vi.mocked(renderReceiptPdf).mockResolvedValue({ pdf: Buffer.from("%PDF-1.4"), number: "MR-0001" })

    const res = await request(app).get("/api/receipts/r1/pdf").set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)

    expect(res.status).toBe(200)
    expect(renderReceiptPdf).toHaveBeenCalledWith("r1", expect.objectContaining({ role: "EMPLOYEE" }))
  })
})
