import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../config/prisma", () => ({
  default: { salesPermission: { findMany: vi.fn() } },
}))

import prisma from "../config/prisma"
import { clearPermissionCache, PERMISSION_OFF_MESSAGE } from "../modules/sales/sales.permissions"
import { requireSalesPermission } from "./requireSalesPermission"

const USER = { sub: "u-2", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const ADMIN = { sub: "u-1", role: "EMPLOYEE", salesRole: "SALES_ADMIN" } as any
const SUPER = { sub: "u-0", role: "SUPER_ADMIN", salesRole: null } as any

async function run(user: unknown) {
  const next = vi.fn()
  await requireSalesPermission("opportunity.create")({ user } as any, {} as any, next)
  return next
}

beforeEach(() => {
  vi.clearAllMocks()
  clearPermissionCache()
  vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([] as never)
})

describe("requireSalesPermission", () => {
  it("passes a Sales User while the switch is on (the default)", async () => {
    const next = await run(USER)
    expect(next).toHaveBeenCalledWith()
  })

  it("refuses a Sales User with the plain message when the switch is off", async () => {
    vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([{ key: "opportunity.create", enabled: false }] as never)
    const next = await run(USER)
    const err = next.mock.calls[0][0]
    expect(err).toMatchObject({ statusCode: 403, message: PERMISSION_OFF_MESSAGE })
  })

  it("never refuses a Sales Admin or the Super Admin", async () => {
    vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([{ key: "opportunity.create", enabled: false }] as never)
    expect(await run(ADMIN)).toHaveBeenCalledWith()
    expect(await run(SUPER)).toHaveBeenCalledWith()
  })

  it("answers 401 when nobody is signed in", async () => {
    const next = await run(undefined)
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 })
  })

  it("hands a failed read to the error handler instead of letting the request through", async () => {
    vi.mocked(prisma.salesPermission.findMany).mockRejectedValue(new Error("db down") as never)
    const next = await run(USER)
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error)
    expect(next).not.toHaveBeenCalledWith()
  })
})
