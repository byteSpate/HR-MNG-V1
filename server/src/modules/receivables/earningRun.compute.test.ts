import { describe, expect, it } from "vitest"
import { Prisma } from "../../generated/prisma/client"
import { computeRunCharges, monthlyTarget } from "./earningRun.compute"

const d = (v: string) => new Prisma.Decimal(v)

const YEAR = { amount: d("365000"), contractStart: new Date("2026-01-01"), contractEnd: new Date("2026-12-31") }

describe("monthlyTarget", () => {
  it("earns by days: January of a 365-day contract is 31 days' worth", () => {
    expect(monthlyTarget(YEAR, new Date("2026-01-31")).toFixed(2)).toBe("31000.00")
  })

  it("earns nothing before the contract starts", () => {
    expect(monthlyTarget(YEAR, new Date("2025-12-31")).toFixed(2)).toBe("0.00")
  })

  it("earns exactly the amount by the end month, whatever rounding came before", () => {
    const odd = { amount: d("100000"), contractStart: new Date("2026-01-15"), contractEnd: new Date("2026-04-14") }
    expect(monthlyTarget(odd, new Date("2026-04-30")).toFixed(2)).toBe("100000.00")
  })

  it("earns the full amount on the exact day the contract ends", () => {
    expect(monthlyTarget(YEAR, new Date("2026-12-31")).toFixed(2)).toBe("365000.00")
  })
})

describe("computeRunCharges", () => {
  it("catches up a skipped month in the next run, and the skipped month then earns nothing (Review Focus 3)", () => {
    const line = { id: "pl1", ...YEAR, earnedSoFar: d("31000") } // January posted, February skipped
    expect(computeRunCharges([line], new Date("2026-03-31"))).toEqual([{ poLineId: "pl1", amount: d("59000") }]) // 28 + 31 days

    const after = { ...line, earnedSoFar: d("90000") } // March run posted
    expect(computeRunCharges([after], new Date("2026-02-28"))).toEqual([])
  })

  it("leaves out a line whose target has not moved since the last run", () => {
    const line = { id: "pl1", ...YEAR, earnedSoFar: d("31000") }
    expect(computeRunCharges([line], new Date("2026-01-31"))).toEqual([])
  })
})
