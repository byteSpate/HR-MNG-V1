import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("../../../config/prisma", () => ({
  default: { salesPermission: { findMany: vi.fn() }, user: { findUnique: vi.fn() } },
}))

import app from "../../../app"
import prisma from "../../../config/prisma"
import { signAccessToken } from "../../auth/auth.utils"
import { clearPermissionCache } from "../sales.permissions"

const auth = (role: string, salesRole: string | null) =>
  `Bearer ${signAccessToken({ sub: "u-1", role: role as never, email: "a@b.c", mustChangePassword: false, salesRole: salesRole as never })}`

beforeEach(() => {
  vi.clearAllMocks()
  clearPermissionCache()
  vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as never)
})

describe.each([
  ["delete", "/api/sales/accounts/x/collaborators/y"],
  ["patch", "/api/sales/removal-requests/x/approve"],
  ["patch", "/api/sales/removal-requests/x/refuse"],
] as const)("%s %s", (method, path) => {
  it("is refused to a Sales User, even with every switch on", async () => {
    vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([{ key: "account.edit", enabled: true }] as never)
    const res = await request(app)[method](path).set("Authorization", auth("EMPLOYEE", "SALES_USER")).send({ reason: "No reason" })
    expect(res.status).toBe(403)
  })

  it("is refused to a login with no Sales Hub access", async () => {
    const res = await request(app)[method](path).set("Authorization", auth("EMPLOYEE", null)).send({})
    expect(res.status).toBe(403)
  })
})

describe("PATCH /api/sales/removal-requests/:id/refuse", () => {
  it("answers 400 with a plain message when a Sales Admin sends no reason", async () => {
    const res = await request(app)
      .patch("/api/sales/removal-requests/x/refuse")
      .set("Authorization", auth("EMPLOYEE", "SALES_ADMIN"))
      .send({ reason: "" })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain("Say why you are refusing")
  })
})
