import { describe, expect, it } from "vitest"
import { VAT_CODES } from "./vatCode.seed"

describe("VAT_CODES", () => {
  it("has the standard rate and No VAT", () => {
    const codes = VAT_CODES.map((c) => c.code)
    expect(codes).toEqual(["STD15", "NOVAT"])
  })

  it("STD15 is fifteen percent", () => {
    expect(VAT_CODES.find((c) => c.code === "STD15")?.ratePercent).toBe("15.00")
  })

  it("No VAT is zero percent, so it adds no VAT to a line", () => {
    expect(VAT_CODES.find((c) => c.code === "NOVAT")?.ratePercent).toBe("0.00")
  })
})
