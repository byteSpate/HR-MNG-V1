import { describe, expect, it } from "vitest"
import { dec, toMoneyString } from "../payroll/payroll.money"
import { linesMargin, marginAmount, marginTotal } from "./sales.margin"

/** A product line: its Total price and its margin percentage, either missing. */
const line = (lineValue: string | null, marginPercent: string | null) => ({
  lineValue: lineValue === null ? null : dec(lineValue),
  marginPercent: marginPercent === null ? null : dec(marginPercent),
})

describe("a product's margin in taka", () => {
  it("is the total price times the margin percentage", () => {
    expect(toMoneyString(marginAmount(dec("10000.00"), dec("12"))!)).toBe("1200.00")
  })

  it("is negative for a product sold at a loss", () => {
    expect(toMoneyString(marginAmount(dec("200000.00"), dec("-5"))!)).toBe("-10000.00")
  })

  it("rounds to the paisa", () => {
    // 12.35% of 999.99 is 123.498765.
    expect(toMoneyString(marginAmount(dec("999.99"), dec("12.35"))!)).toBe("123.50")
  })

  it("is unknown, not zero, when the product has no total price or no percentage", () => {
    expect(marginAmount(null, dec("12"))).toBeNull()
    expect(marginAmount(dec("10000.00"), null)).toBeNull()
  })
})

describe("a deal's margin, from its products", () => {
  it("adds up the products whose margin can be worked out, and counts the rest", () => {
    const margin = linesMargin([line("10000", "12"), line("5000", "10"), line(null, "15"), line("3000", null)])

    // 1,200 + 500. The other two are left out and counted, never summed as zero.
    expect(margin).toEqual({ value: "1700.00", counted: 2, missing: 2 })
  })

  it("has no margin, rather than ৳0, when no product carries one", () => {
    expect(linesMargin([line("10000", null)]).value).toBeNull()
    expect(linesMargin([]).value).toBeNull()
  })

  it("lets a product sold at a loss reduce the deal's margin", () => {
    expect(linesMargin([line("10000", "10"), line("2000", "-5")]).value).toBe("900.00")
  })
})

describe("a margin total across won deals", () => {
  it("adds the products of every deal, and names what it could not count", () => {
    const total = marginTotal([
      { lines: [line("10000", "12"), line("5000", null)] },
      { lines: [line("20000", "10")] },
      { lines: [] },
    ])

    // 1,200 + 2,000. One product has no margin; one won deal has no products.
    expect(total).toEqual({ value: "3200.00", counted: 2, missing: 1, dealsWithoutProducts: 1 })
  })

  it("is zero with nothing counted for no deals at all", () => {
    expect(marginTotal([])).toEqual({ value: "0.00", counted: 0, missing: 0, dealsWithoutProducts: 0 })
  })
})
