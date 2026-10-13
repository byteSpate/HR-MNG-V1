import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/env", () => ({ env: { APP_TIMEZONE: "Asia/Dhaka" } }))
vi.mock("../../../config/prisma", () => ({
  default: {
    salesTarget: { findMany: vi.fn() },
    opportunity: { findMany: vi.fn(), groupBy: vi.fn() },
  },
}))

import prisma from "../../../config/prisma"
import { readQuarterSummaries } from "./funnel.quarter"

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const PEOPLE = [{ id: "emp-1", fullName: "Rahim" }, { id: "emp-2", fullName: "Karim" }]
const NOW = new Date("2026-10-13T06:00:00.000Z")

beforeEach(() => {
  vi.clearAllMocks()
  mocked(prisma.salesTarget.findMany).mockResolvedValue([
    { employeeId: "emp-1", amount: "4000000.00", startQuarter: 1, note: null },
  ])
  // emp-1 won 300,000 in Q4 so far.
  mocked(prisma.opportunity.findMany).mockResolvedValue([
    { wonByEmployeeId: "emp-1", amount: "300000.00", closedAt: new Date("2026-10-05T06:00:00.000Z") },
  ])
  mocked(prisma.opportunity.groupBy)
    .mockResolvedValueOnce([{ ownerEmployeeId: "emp-1", _sum: { amount: "1500000.00" }, _count: { amount: 2 } }])
    .mockResolvedValueOnce([{ ownerEmployeeId: "emp-2", _count: { _all: 3 } }])
})

describe("readQuarterSummaries", () => {
  it("measures each person against their own target for the quarter", async () => {
    const map = await readQuarterSummaries(PEOPLE, 2026, 4, NOW)
    const rahim = map.get("emp-1")!
    expect(rahim).toMatchObject({ quarterLabel: "Q4 2026", won: "300000.00", openQuoted: "1500000.00", quoteMissingCount: 0 })
    expect(rahim.target).not.toBeNull()
    expect(rahim.coverage).not.toBeNull()
  })

  it("gives a person with no target nulls, not zeros", async () => {
    const karim = (await readQuarterSummaries(PEOPLE, 2026, 4, NOW)).get("emp-2")!
    expect(karim).toMatchObject({ target: null, gap: null, coverage: null, openQuoted: null, won: "0.00", quoteMissingCount: 3 })
  })

  it("asks only for open, quoted Opportunities closing in the quarter, and those with no quote", async () => {
    await readQuarterSummaries(PEOPLE, 2026, 4, NOW)
    const [open, missing] = mocked(prisma.opportunity.groupBy).mock.calls.map((c) => c[0])
    expect(open.where).toMatchObject({
      ownerEmployeeId: { in: ["emp-1", "emp-2"] }, offeredOn: { not: null }, status: "ONGOING",
      expectedCloseDate: { gte: new Date("2026-10-01T00:00:00.000Z"), lt: new Date("2027-01-01T00:00:00.000Z") },
    })
    expect(missing.where).toMatchObject({ offeredOn: { not: null }, status: "ONGOING", quotes: { none: {} } })
  })

  it("reads nothing for nobody", async () => {
    expect((await readQuarterSummaries([], 2026, 4, NOW)).size).toBe(0)
    expect(prisma.salesTarget.findMany).not.toHaveBeenCalled()
  })
})
