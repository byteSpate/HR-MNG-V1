import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("../../../config/prisma", () => ({
  default: { $transaction: vi.fn(), salesPermission: { findMany: vi.fn().mockResolvedValue([]) } },
}))
// The service is tested on its own; here only the door is under test.
vi.mock("./payments.service", () => ({ listPayments: vi.fn() }))

import app from "../../../app"
import { signAccessToken } from "../../auth/auth.utils"
import { listPayments } from "./payments.service"

const token = (salesRole: "SALES_ADMIN" | "SALES_USER" | null, role = "EMPLOYEE") =>
  `Bearer ${signAccessToken({ sub: "user-1", role: role as never, email: "a@demo.com", mustChangePassword: false, salesRole: salesRole as never })}`
const ACC = "11111111-1111-4111-8111-111111111111"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listPayments).mockResolvedValue({ rows: [], totals: { invoiceTotal: "0.00", received: "0.00", balance: "0.00" } })
})

describe("the Payments routes (Sales Admin and Super Admin only)", () => {
  it("refuse a Sales User, on the list and on the download", async () => {
    await request(app).get("/api/sales/payments").set("Authorization", token("SALES_USER")).expect(403)
    await request(app).get("/api/sales/payments/export?format=csv").set("Authorization", token("SALES_USER")).expect(403)
    expect(listPayments).not.toHaveBeenCalled()
  })

  it("let a Sales Admin and a Super Admin in, and pass the filter through", async () => {
    await request(app).get(`/api/sales/payments?accountId=${ACC}&open=true`).set("Authorization", token("SALES_ADMIN")).expect(200)
    expect(vi.mocked(listPayments).mock.calls[0][0]).toEqual({ accountId: ACC, open: true })
    await request(app).get("/api/sales/payments").set("Authorization", token(null, "SUPER_ADMIN")).expect(200)
  })

  it("turn away an id that is not an id, in plain words", async () => {
    const res = await request(app).get("/api/sales/payments?accountId=nope").set("Authorization", token("SALES_ADMIN")).expect(400)
    expect(res.body.error).toBe("That account or Opportunity was not found. Reload the page and try again.")
  })
})
