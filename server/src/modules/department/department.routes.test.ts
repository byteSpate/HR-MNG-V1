import { describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    department: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    employee: { count: vi.fn() },
    announcement: { count: vi.fn() },
    asset: { count: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import app from "../../app"
import prisma from "../../config/prisma"
import { signAccessToken } from "../auth/auth.utils"

function tokenFor(role: "EMPLOYEE" | "HR_ADMIN" | "FINANCE_OFFICER") {
  return signAccessToken({ sub: "actor-1", role: role as any, email: "actor@b.com", mustChangePassword: false, salesRole: null })
}

describe("GET /api/departments", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await request(app).get("/api/departments")
    expect(res.status).toBe(401)
  })

  it("returns 200 with the department list for any authenticated role", async () => {
    vi.mocked(prisma.department.findMany).mockResolvedValue([
      { id: "d1", name: "Engineering" },
      { id: "d2", name: "Sales" },
    ] as any)
    const res = await request(app).get("/api/departments").set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      { id: "d1", name: "Engineering" },
      { id: "d2", name: "Sales" },
    ])
    expect(prisma.department.findMany).toHaveBeenCalledWith({
      select: { id: true, name: true, costNature: true },
      orderBy: { name: "asc" },
    })
  })
})

describe("department writes", () => {
  it("refuses POST for a role outside HR", async () => {
    const res = await request(app)
      .post("/api/departments")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
      .send({ name: "Design" })
    expect(res.status).toBe(403)
  })

  it("creates for HR_ADMIN", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
    vi.mocked(prisma.department.create).mockResolvedValue({ id: "d1", name: "Design" } as any)

    const res = await request(app)
      .post("/api/departments")
      .set("Authorization", `Bearer ${tokenFor("HR_ADMIN")}`)
      .send({ name: "Design" })

    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: "d1", name: "Design" })
  })

  it("400s an empty name", async () => {
    const res = await request(app)
      .post("/api/departments")
      .set("Authorization", `Bearer ${tokenFor("HR_ADMIN")}`)
      .send({ name: "   " })
    expect(res.status).toBe(400)
  })

  it("refuses DELETE for a role outside HR", async () => {
    const res = await request(app)
      .delete("/api/departments/d1")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(res.status).toBe(403)
  })

  it("returns 204 on a clean delete", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
    vi.mocked(prisma.department.findUnique).mockResolvedValue({ id: "d1", name: "Design" } as any)
    vi.mocked(prisma.employee.count).mockResolvedValue(0)
    vi.mocked(prisma.announcement.count).mockResolvedValue(0)
    vi.mocked(prisma.asset.count).mockResolvedValue(0)

    const res = await request(app)
      .delete("/api/departments/d1")
      .set("Authorization", `Bearer ${tokenFor("HR_ADMIN")}`)
    expect(res.status).toBe(204)
  })
})
