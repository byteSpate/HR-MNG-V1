import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    salesPermission: { findMany: vi.fn(), upsert: vi.fn() },
    user: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import app from "../../../app"
import prisma from "../../../config/prisma"
import { signAccessToken } from "../../auth/auth.utils"
import { clearPermissionCache } from "../sales.permissions"

const auth = (role: string, salesRole: string | null, sub = "u-1") =>
  `Bearer ${signAccessToken({ sub, role: role as never, email: "a@b.c", mustChangePassword: false, salesRole: salesRole as never })}`

beforeEach(() => {
  vi.clearAllMocks()
  clearPermissionCache()
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: any) => fn(prisma)) as never)
  vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.user.findMany).mockResolvedValue([] as never)
})

describe("GET /api/sales/permissions", () => {
  it("lists every switch for a Sales User", async () => {
    const res = await request(app).get("/api/sales/permissions").set("Authorization", auth("EMPLOYEE", "SALES_USER"))
    expect(res.status).toBe(200)
    expect(res.body.items.length).toBeGreaterThanOrEqual(16)
    expect(res.body.items[0]).toEqual(
      expect.objectContaining({ key: expect.any(String), label: expect.any(String), enabled: expect.any(Boolean) })
    )
  })

  it("refuses a login with no Sales Hub access", async () => {
    const res = await request(app).get("/api/sales/permissions").set("Authorization", auth("EMPLOYEE", null))
    expect(res.status).toBe(403)
  })
})

describe("GET /api/sales/permissions/me", () => {
  it("answers the caller's own switches", async () => {
    vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([{ key: "task.create", enabled: false }] as never)
    const res = await request(app).get("/api/sales/permissions/me").set("Authorization", auth("EMPLOYEE", "SALES_USER"))
    expect(res.status).toBe(200)
    expect(res.body.permissions["task.create"]).toBe(false)
    expect(res.body.permissions["meeting.create"]).toBe(true)
  })

  it("answers true for everything to a Sales Admin", async () => {
    vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([{ key: "task.create", enabled: false }] as never)
    const res = await request(app).get("/api/sales/permissions/me").set("Authorization", auth("EMPLOYEE", "SALES_ADMIN"))
    expect(res.body.permissions["task.create"]).toBe(true)
  })
})

describe("PUT /api/sales/permissions", () => {
  const body = { changes: [{ key: "task.create", enabled: false }] }

  it("refuses a Sales User", async () => {
    const res = await request(app)
      .put("/api/sales/permissions")
      .set("Authorization", auth("EMPLOYEE", "SALES_USER"))
      .send(body)
    expect(res.status).toBe(403)
    expect(prisma.salesPermission.upsert).not.toHaveBeenCalled()
  })

  it("saves for a Sales Admin and answers the new list", async () => {
    const res = await request(app)
      .put("/api/sales/permissions")
      .set("Authorization", auth("EMPLOYEE", "SALES_ADMIN"))
      .send(body)
    expect(res.status).toBe(200)
    expect(prisma.salesPermission.upsert).toHaveBeenCalledTimes(1)
    expect(Array.isArray(res.body.items)).toBe(true)
  })

  it("saves for the Super Admin", async () => {
    const res = await request(app).put("/api/sales/permissions").set("Authorization", auth("SUPER_ADMIN", null)).send(body)
    expect(res.status).toBe(200)
  })

  it("answers 400 for an unknown key", async () => {
    const res = await request(app)
      .put("/api/sales/permissions")
      .set("Authorization", auth("EMPLOYEE", "SALES_ADMIN"))
      .send({ changes: [{ key: "nope.nope", enabled: true }] })
    expect(res.status).toBe(400)
    expect(prisma.salesPermission.upsert).not.toHaveBeenCalled()
  })

  it("answers 400 for an empty list", async () => {
    const res = await request(app)
      .put("/api/sales/permissions")
      .set("Authorization", auth("EMPLOYEE", "SALES_ADMIN"))
      .send({ changes: [] })
    expect(res.status).toBe(400)
  })
})
