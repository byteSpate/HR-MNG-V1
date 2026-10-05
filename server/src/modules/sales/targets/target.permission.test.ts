import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    salesPermission: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    employee: { findUnique: vi.fn() },
    salesTarget: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
  },
}))

import prisma from "../../../config/prisma"
import { clearPermissionCache } from "../sales.permissions"
import { getTargetYear, OWN_TARGET, setSalesTarget, TARGET_NOT_ALLOWED } from "./target.service"

const USER = { sub: "u-2", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const ADMIN = { sub: "u-1", role: "EMPLOYEE", salesRole: "SALES_ADMIN" } as any
const body = { employeeId: "emp-9", calendarYear: 2026, amount: "4000000", startQuarter: 1 } as any

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
  vi.mocked(prisma.employee.findUnique).mockResolvedValue(null as never)
})

describe("setSalesTarget and the target.set switch", () => {
  it("refuses a Sales User while the switch is off (its default)", async () => {
    expect(await failureOf(() => setSalesTarget(body, USER))).toMatchObject({ statusCode: 403, message: TARGET_NOT_ALLOWED })
  })

  it("refuses a Sales User setting their own Target, even with the switch on", async () => {
    switches([{ key: "target.set", enabled: true }])
    const err = await failureOf(() => setSalesTarget({ ...body, employeeId: "emp-2" }, USER))
    expect(err).toMatchObject({ statusCode: 403, message: OWN_TARGET })
  })

  it("lets a Sales User past the gate when it is on and the Target is for someone else", async () => {
    switches([{ key: "target.set", enabled: true }])
    // Past the gate, the next thing the service does is look the person up.
    expect(await failureOf(() => setSalesTarget(body, USER))).toMatchObject({ statusCode: 400 })
    expect(prisma.employee.findUnique).toHaveBeenCalled()
  })

  it("never refuses a Sales Admin", async () => {
    switches([{ key: "target.set", enabled: false }])
    expect(await failureOf(() => setSalesTarget(body, ADMIN))).toMatchObject({ statusCode: 400 })
  })
})

describe("getTargetYear and another person's Target", () => {
  const query = { employeeId: "emp-9", calendarYear: 2026 } as any

  it("refuses a Sales User with neither team.dashboard nor target.set", async () => {
    expect(await failureOf(() => getTargetYear(query, USER))).toMatchObject({ statusCode: 403 })
  })

  it("allows it with team.dashboard", async () => {
    switches([{ key: "team.dashboard", enabled: true }])
    expect((await failureOf(() => getTargetYear(query, USER)))?.statusCode).not.toBe(403)
  })

  it("allows it with target.set, so the editor can load the current figure", async () => {
    switches([{ key: "target.set", enabled: true }])
    expect((await failureOf(() => getTargetYear(query, USER)))?.statusCode).not.toBe(403)
  })
})
