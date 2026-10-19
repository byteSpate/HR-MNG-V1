import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("../../../config/prisma", () => ({
  default: { $transaction: vi.fn(), salesPermission: { findMany: vi.fn().mockResolvedValue([]) } },
}))
// The service is tested on its own; here only the door is under test.
vi.mock("./contacts.service", () => ({ listAllContacts: vi.fn() }))

import app from "../../../app"
import { signAccessToken } from "../../auth/auth.utils"
import { listAllContacts } from "./contacts.service"

const token = (salesRole: "SALES_ADMIN" | "SALES_USER" | null) =>
  `Bearer ${signAccessToken({ sub: "user-1", role: "EMPLOYEE" as never, email: "a@demo.com", mustChangePassword: false, salesRole: salesRole as never })}`

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listAllContacts).mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 50 })
})

describe("the Contacts routes", () => {
  it("need a signed-in person in the Sales Hub", async () => {
    await request(app).get("/api/sales/contacts").expect(401)
    await request(app).get("/api/sales/contacts").set("Authorization", token(null)).expect(403)
    await request(app).get("/api/sales/contacts/export?format=csv").set("Authorization", token(null)).expect(403)
    expect(listAllContacts).not.toHaveBeenCalled()
  })

  it("pass the search and paging through", async () => {
    await request(app).get("/api/sales/contacts?q=alpha&page=2&sort=account&dir=desc").set("Authorization", token("SALES_USER")).expect(200)
    expect(vi.mocked(listAllContacts).mock.calls[0][0]).toEqual({ q: "alpha", page: 2, sort: "account", dir: "desc" })
  })

  it("refuse a bad sort with a plain sentence", async () => {
    const res = await request(app).get("/api/sales/contacts?sort=salary").set("Authorization", token("SALES_USER")).expect(400)
    expect(res.body.error).toBe("Sort by name, job title, account or status.")
  })
})
