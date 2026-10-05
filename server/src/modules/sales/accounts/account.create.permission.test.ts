import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    salesPermission: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}))

import app from "../../../app"
import prisma from "../../../config/prisma"
import { signAccessToken } from "../../auth/auth.utils"
import { clearPermissionCache, PERMISSION_OFF_MESSAGE } from "../sales.permissions"
import { NO_EMPLOYEE_RECORD, ONLY_FOR_YOURSELF } from "./account.create-rules"

const USER = `Bearer ${signAccessToken({ sub: "u-2", role: "EMPLOYEE" as never, email: "a@b.c", mustChangePassword: false, salesRole: "SALES_USER" as never })}`
const UUID = "11111111-1111-4111-8111-111111111111"

beforeEach(() => {
  vi.clearAllMocks()
  clearPermissionCache()
  vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([{ key: "account.create", enabled: true }] as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: UUID } } as never)
})

describe("POST /api/sales/accounts as a Sales User", () => {
  it("is refused while the switch is off (its default)", async () => {
    vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([] as never)
    const res = await request(app).post("/api/sales/accounts").set("Authorization", USER).send({ name: "Rising Group" })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe(PERMISSION_OFF_MESSAGE)
  })

  it("refuses a body that names someone else as the Owner", async () => {
    const res = await request(app)
      .post("/api/sales/accounts")
      .set("Authorization", USER)
      .send({ name: "Rising Group", ownerEmployeeId: "22222222-2222-4222-8222-222222222222" })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe(ONLY_FOR_YOURSELF)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("answers the plain message to a login with no Employee row", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: null } as never)
    const res = await request(app).post("/api/sales/accounts").set("Authorization", USER).send({ name: "Rising Group" })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe(NO_EMPLOYEE_RECORD)
  })

  it("lets a body with no Owner through to the transaction", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(new Error("reached the transaction") as never)
    const res = await request(app).post("/api/sales/accounts").set("Authorization", USER).send({ name: "Rising Group" })
    expect(prisma.$transaction).toHaveBeenCalled()
    expect(res.status).toBe(500)
  })
})
