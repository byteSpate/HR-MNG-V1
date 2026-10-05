import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    salesPermission: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}))

import prisma from "../../../config/prisma"
import { clearPermissionCache } from "../sales.permissions"
import { getSalesDashboard } from "./dashboard.service"

const USER = { sub: "u-2", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const ADMIN = { sub: "u-1", role: "EMPLOYEE", salesRole: "SALES_ADMIN" } as any

async function failureOf(run: () => Promise<unknown>) {
  try {
    await run()
    return null
  } catch (err) {
    return err as { statusCode?: number; message: string }
  }
}

function switches(rows: Array<{ key: string; enabled: boolean }>) {
  vi.mocked(prisma.salesPermission.findMany).mockResolvedValue(rows as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  clearPermissionCache()
  switches([])
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-2" } } as never)
})

describe("getSalesDashboard and the team.dashboard switch", () => {
  it("refuses the whole-team view to a Sales User while the switch is off", async () => {
    expect(await failureOf(() => getSalesDashboard({ employeeId: "all" } as any, USER))).toMatchObject({ statusCode: 403 })
  })

  it("refuses another person's dashboard to a Sales User while the switch is off", async () => {
    expect(await failureOf(() => getSalesDashboard({ employeeId: "emp-9" } as any, USER))).toMatchObject({ statusCode: 403 })
  })

  it("does not refuse the whole-team view for that reason once it is on", async () => {
    switches([{ key: "team.dashboard", enabled: true }])
    expect((await failureOf(() => getSalesDashboard({ employeeId: "all" } as any, USER)))?.statusCode).not.toBe(403)
  })

  it("does not refuse another person's dashboard for that reason once it is on", async () => {
    switches([{ key: "team.dashboard", enabled: true }])
    expect((await failureOf(() => getSalesDashboard({ employeeId: "emp-9" } as any, USER)))?.statusCode).not.toBe(403)
  })

  it("never refuses a Sales Admin", async () => {
    switches([{ key: "team.dashboard", enabled: false }])
    expect((await failureOf(() => getSalesDashboard({ employeeId: "all" } as any, ADMIN)))?.statusCode).not.toBe(403)
  })
})
