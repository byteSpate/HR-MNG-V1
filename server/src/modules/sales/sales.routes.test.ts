import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    salesAccount: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    salesAccountAssignment: { createMany: vi.fn() },
    employee: { findUnique: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    event: { create: vi.fn() },
  },
}))

import app from "../../app"
import prisma from "../../config/prisma"
import { signAccessToken } from "../auth/auth.utils"

type Actor = {
  role: "EMPLOYEE" | "HR_ADMIN" | "SUPER_ADMIN"
  salesRole: "SALES_ADMIN" | "SALES_USER" | null
  sub?: string
}

function tokenFor({ role, salesRole, sub = "user-1" }: Actor) {
  return signAccessToken({
    sub,
    role: role as never,
    email: "actor@demo.com",
    mustChangePassword: false,
    salesRole: salesRole as never,
  })
}

const auth = (actor: Actor) => `Bearer ${tokenFor(actor)}`

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: never) =>
    (fn as unknown as (c: typeof prisma) => unknown)(prisma)) as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as never)
  vi.mocked(prisma.salesAccount.findMany).mockResolvedValue([] as never)
})

describe("GET /api/sales/accounts", () => {
  it("401s without a token", async () => {
    await request(app).get("/api/sales/accounts").expect(401)
  })

  it("403s an authenticated employee with no salesRole", async () => {
    await request(app)
      .get("/api/sales/accounts")
      .set("Authorization", auth({ role: "EMPLOYEE", salesRole: null }))
      .expect(403)
  })

  it("200s a Sales User", async () => {
    await request(app)
      .get("/api/sales/accounts")
      .set("Authorization", auth({ role: "EMPLOYEE", salesRole: "SALES_USER" }))
      .expect(200)
  })

  it("scopes a Sales User to what they own or are assigned to", async () => {
    await request(app)
      .get("/api/sales/accounts")
      .set("Authorization", auth({ role: "EMPLOYEE", salesRole: "SALES_USER" }))
      .expect(200)

    expect(prisma.salesAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ ownerEmployeeId: "emp-1" }, { assignments: { some: { employeeId: "emp-1" } } }],
        },
      })
    )
  })

  it("does not scope a Sales Admin", async () => {
    await request(app)
      .get("/api/sales/accounts")
      .set("Authorization", auth({ role: "EMPLOYEE", salesRole: "SALES_ADMIN" }))
      .expect(200)

    expect(prisma.salesAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    )
  })
})

describe("GET /api/sales/accounts/:id", () => {
  // A 403 would confirm the account exists to somebody not allowed to know
  // that it does.
  it("404s, not 403s, when the account is outside the caller's scope", async () => {
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue(null as never)

    const res = await request(app)
      .get("/api/sales/accounts/sa-9")
      .set("Authorization", auth({ role: "EMPLOYEE", salesRole: "SALES_USER" }))

    expect(res.status).toBe(404)
    // Asserted so this cannot pass because the route is missing — an
    // unmounted router 404s too, and that is a different fact entirely.
    expect(res.body.error).toMatch(/does not exist, or is not yours/)
    expect(prisma.salesAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { id: "sa-9" },
            {
              OR: [
                { ownerEmployeeId: "emp-1" },
                { assignments: { some: { employeeId: "emp-1" } } },
              ],
            },
          ],
        },
      })
    )
  })

  it("returns the account when it is in scope", async () => {
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue({
      id: "sa-1",
      name: "Rising Group",
      status: "ACTIVE",
      ownerEmployeeId: "emp-1",
      createdAt: new Date("2026-09-06"),
      owner: { fullName: "Karim" },
      _count: { assignments: 2 },
    } as never)

    const res = await request(app)
      .get("/api/sales/accounts/sa-1")
      .set("Authorization", auth({ role: "EMPLOYEE", salesRole: "SALES_USER" }))

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: "sa-1", ownerName: "Karim", assigneeCount: 2 })
  })
})

describe("POST /api/sales/accounts", () => {
  const validBody = {
    name: "New Co",
    ownerEmployeeId: "11111111-1111-4111-8111-111111111111",
  }

  it("403s a Sales User", async () => {
    await request(app)
      .post("/api/sales/accounts")
      .set("Authorization", auth({ role: "EMPLOYEE", salesRole: "SALES_USER" }))
      .send(validBody)
      .expect(403)

    expect(prisma.salesAccount.create).not.toHaveBeenCalled()
  })

  it("201s for a Sales Admin", async () => {
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      id: validBody.ownerEmployeeId,
      fullName: "Karim",
    } as never)
    vi.mocked(prisma.salesAccount.create).mockResolvedValue({
      id: "sa-2",
      name: "New Co",
      status: "ACTIVE",
      ownerEmployeeId: validBody.ownerEmployeeId,
      createdAt: new Date("2026-09-06"),
    } as never)

    const res = await request(app)
      .post("/api/sales/accounts")
      .set("Authorization", auth({ role: "EMPLOYEE", salesRole: "SALES_ADMIN" }))
      .send(validBody)

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ id: "sa-2", name: "New Co" })
  })

  it("400s a body with no owner", async () => {
    await request(app)
      .post("/api/sales/accounts")
      .set("Authorization", auth({ role: "EMPLOYEE", salesRole: "SALES_ADMIN" }))
      .send({ name: "New Co" })
      .expect(400)
  })
})
