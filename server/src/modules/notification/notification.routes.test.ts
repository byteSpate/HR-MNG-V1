import { describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("../../config/prisma", () => ({
  default: {
    emailDispatch: { findMany: vi.fn() },
  },
}))

import app from "../../app"
import prisma from "../../config/prisma"
import { signAccessToken } from "../auth/auth.utils"

function tokenFor(role: "EMPLOYEE" | "HR_ADMIN" | "FINANCE_OFFICER" | "SUPER_ADMIN") {
  return signAccessToken({
    sub: "actor-1",
    role: role as any,
    email: "actor@b.com",
    mustChangePassword: false,
  })
}

describe("GET /api/emails", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await request(app).get("/api/emails")
    expect(res.status).toBe(401)
  })

  it("refuses a FINANCE_OFFICER — the log carries every address in the company", async () => {
    const res = await request(app)
      .get("/api/emails")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)

    expect(res.status).toBe(403)
  })

  it("refuses an HR_ADMIN", async () => {
    const res = await request(app)
      .get("/api/emails")
      .set("Authorization", `Bearer ${tokenFor("HR_ADMIN")}`)

    expect(res.status).toBe(403)
  })

  it("returns the log to a SUPER_ADMIN", async () => {
    vi.mocked(prisma.emailDispatch.findMany).mockResolvedValue([
      {
        id: "d1",
        to: "a@b.com",
        kind: "PAYSLIP",
        subject: "Payslip for August 2026",
        entity: "PAYSLIP",
        entityId: "p1",
        sentAt: new Date("2026-08-20T10:00:00.000Z"),
        error: null,
        createdAt: new Date("2026-08-20T09:59:00.000Z"),
      },
    ] as any)

    const res = await request(app)
      .get("/api/emails")
      .set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].sentAt).toBe("2026-08-20T10:00:00.000Z")
    expect(res.body.nextCursor).toBeNull()
  })

  it("passes the failures-only filter through as errored-and-never-sent", async () => {
    vi.mocked(prisma.emailDispatch.findMany).mockResolvedValue([] as any)

    const res = await request(app)
      .get("/api/emails?failedOnly=true")
      .set("Authorization", `Bearer ${tokenFor("SUPER_ADMIN")}`)

    expect(res.status).toBe(200)
    expect(prisma.emailDispatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { error: { not: null }, sentAt: null } })
    )
  })
})
