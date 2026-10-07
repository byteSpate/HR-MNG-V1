import { describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./supplierPayment.service", () => ({
  listSupplierPayments: vi.fn(),
  getSupplierPayment: vi.fn(),
  createSupplierPayment: vi.fn(),
}))
vi.mock("./supplierPayment.posting", () => ({ reverseSupplierPayment: vi.fn() }))
vi.mock("./supplierPayment.pdf", () => ({ renderSupplierPaymentPdf: vi.fn() }))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"
import { listSupplierPayments } from "./supplierPayment.service"
import { reverseSupplierPayment } from "./supplierPayment.posting"
import { renderSupplierPaymentPdf } from "./supplierPayment.pdf"
import { AppError } from "../../middleware/errorHandler"

function tokenFor(role: "EMPLOYEE" | "FINANCE_OFFICER" | "SUPER_ADMIN") {
  return signAccessToken({ sub: "actor-1", role: role as any, email: "a@b.com", mustChangePassword: false, salesRole: null })
}

describe("GET /api/supplier-payments", () => {
  it("refuses with no token", async () => {
    const res = await request(app).get("/api/supplier-payments")
    expect(res.status).toBe(401)
  })
})

describe("GET /api/supplier-payments (read gate)", () => {
  it("refuses an employee with 403: supplier payments are Finance and Admin only", async () => {
    const res = await request(app).get("/api/supplier-payments").set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(res.status).toBe(403)
  })
  it("refuses an employee reading one payment with 403", async () => {
    const res = await request(app).get("/api/supplier-payments/p1").set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(res.status).toBe(403)
  })
  it("passes through to the service for Finance", async () => {
    vi.mocked(listSupplierPayments).mockResolvedValue([] as any)
    const res = await request(app).get("/api/supplier-payments").set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(200)
  })
})

describe("POST /api/supplier-payments", () => {
  it("refuses a non-Finance, non-Admin role with 403", async () => {
    const res = await request(app)
      .post("/api/supplier-payments")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
      .send({})
    expect(res.status).toBe(403)
  })
})

describe("POST /api/supplier-payments/:id/approve", () => {
  it("no longer has an /approve route: a payment posts and is saved approved on creation", async () => {
    const res = await request(app).post("/api/supplier-payments/p1/approve").set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)
    expect(res.status).toBe(404)
  })
})

describe("POST /api/supplier-payments/:id/reverse", () => {
  it("403s Finance reversing: reversal is Super Admin only", async () => {
    const res = await request(app)
      .post("/api/supplier-payments/p1/reverse")
      .send({ reason: "x" })
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(403)
  })

  it("lets a Super Admin reverse a payment with a reason", async () => {
    vi.mocked(reverseSupplierPayment).mockResolvedValue({ id: "p1", status: "REVERSED" } as any)
    const res = await request(app)
      .post("/api/supplier-payments/p1/reverse")
      .send({ reason: "Typed the wrong amount" })
      .set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)
    expect(res.status).toBe(200)
    expect(reverseSupplierPayment).toHaveBeenCalledWith("p1", { reason: "Typed the wrong amount" }, expect.objectContaining({ sub: "actor-1" }))
  })

  it("400s a reversal with no reason", async () => {
    const res = await request(app)
      .post("/api/supplier-payments/p1/reverse")
      .send({})
      .set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)
    expect(res.status).toBe(400)
  })
})

describe("GET /api/supplier-payments/:id/pdf", () => {
  it("refuses with no token", async () => {
    expect((await request(app).get("/api/supplier-payments/p1/pdf")).status).toBe(401)
  })

  it("refuses an employee: supplier money is for Finance and Super Admin only", async () => {
    expect((await request(app).get("/api/supplier-payments/p1/pdf").set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)).status).toBe(403)
    expect(renderSupplierPaymentPdf).not.toHaveBeenCalled()
  })

  it("sends the PDF as a download named after the voucher number", async () => {
    vi.mocked(renderSupplierPaymentPdf).mockResolvedValue({ pdf: Buffer.from("%PDF-1.4"), number: "PV-0001" })

    const res = await request(app).get("/api/supplier-payments/p1/pdf").set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)

    expect(res.status).toBe(200)
    expect(res.headers["content-type"]).toContain("application/pdf")
    expect(res.headers["content-disposition"]).toBe('attachment; filename="PV-0001.pdf"')
    expect(renderSupplierPaymentPdf).toHaveBeenCalledWith("p1")
  })

  it("lets a Super Admin download too", async () => {
    vi.mocked(renderSupplierPaymentPdf).mockResolvedValue({ pdf: Buffer.from("%PDF-1.4"), number: "PV-0001" })

    expect((await request(app).get("/api/supplier-payments/p1/pdf").set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)).status).toBe(200)
  })

  it("says Supplier payment not found for an unknown payment", async () => {
    vi.mocked(renderSupplierPaymentPdf).mockRejectedValue(new AppError(404, "Supplier payment not found"))

    const res = await request(app).get("/api/supplier-payments/nope/pdf").set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: "Supplier payment not found" })
  })
})
