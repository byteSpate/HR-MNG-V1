import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    salesPermission: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}))

import prisma from "../../../config/prisma"
import { clearPermissionCache } from "../sales.permissions"
import { FUNNEL_NOT_YOURS, listFunnelTeam } from "./funnel.service"

const USER = { sub: "u-2", role: "EMPLOYEE", salesRole: "SALES_USER" } as any

async function failureOf(run: () => Promise<unknown>) {
  try {
    await run()
    return null
  } catch (err) {
    return err as { statusCode?: number; message: string }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  clearPermissionCache()
  vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-2" } } as never)
})

describe("listFunnelTeam and the team.funnel switch", () => {
  it("refuses a Sales User while the switch is off (its default)", async () => {
    expect(await failureOf(() => listFunnelTeam(USER))).toMatchObject({ statusCode: 403, message: FUNNEL_NOT_YOURS })
  })

  it("does not refuse a Sales User for that reason once it is on", async () => {
    vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([{ key: "team.funnel", enabled: true }] as never)
    const err = await failureOf(() => listFunnelTeam(USER))
    expect(err?.message).not.toBe(FUNNEL_NOT_YOURS)
  })
})
