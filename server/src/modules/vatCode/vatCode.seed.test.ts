import { describe, expect, it } from "vitest"
import { VAT_CODES } from "./vatCode.seed"

describe("VAT_CODES", () => {
  it("includes the three seeded rates", () => {
    const codes = VAT_CODES.map((c) => c.code)
    expect(codes).toEqual(["STD15", "ZERO", "EXEMPT"])
  })

  it("STD15 is fifteen percent", () => {
    expect(VAT_CODES.find((c) => c.code === "STD15")?.ratePercent).toBe("15.00")
  })
})
