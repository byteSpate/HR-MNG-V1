import { describe, expect, it } from "vitest"
import { Prisma } from "../../generated/prisma/client"

import { vatFor } from "./receivables.vat"
import { MANUAL_RATE_MISSING, requireManualRate, vatChoiceFields } from "./receivables.vat.validators"

/** amount × ratePercent / 100, rounded to the paisa. A financial rule, so
 *  every branch is pinned here rather than only through a document write. */
describe("vatFor", () => {
  const vat = (amount: string, rate: string) => vatFor(new Prisma.Decimal(amount), new Prisma.Decimal(rate)).toFixed(2)

  it("is amount times the rate over a hundred", () => {
    expect(vat("1000", "15")).toBe("150.00")
    expect(vat("800000", "7.5")).toBe("60000.00")
  })

  it("rounds to the paisa, halves away from zero in Prisma's own rule", () => {
    expect(vat("333.33", "7.25")).toBe("24.17")
    expect(vat("1", "7.5")).toBe("0.08")
    expect(vat("10", "1")).toBe("0.10")
  })

  it("is zero for a zero rate, not an error", () => {
    expect(vat("500000", "0")).toBe("0.00")
  })

  it("works on a large figure, rounding the paisa rather than dropping it", () => {
    // 99999999.99 x 15% is 14999999.9985, which is 15000000.00 to the paisa.
    expect(vat("99999999.99", "15")).toBe("15000000.00")
    expect(vat("99999999.99", "15.5")).toBe("15500000.00")
  })
})

describe("the VAT choice fields", () => {
  it("defaults to the VAT code, and the rate to absent", () => {
    expect(vatChoiceFields.vatMethod.parse(undefined)).toBe("CODE")
    expect(vatChoiceFields.vatRatePercent.parse(undefined)).toBeUndefined()
  })

  it("accepts 0, 100, and up to two decimals", () => {
    for (const rate of ["0", "7.5", "7.50", "100", "99.99"]) {
      expect(vatChoiceFields.vatRatePercent.safeParse(rate).success).toBe(true)
    }
  })

  it("refuses over 100, more decimals, a sign, and letters", () => {
    for (const rate of ["100.01", "1000", "7.555", "-5", "seven", "", " 7.5"]) {
      expect(vatChoiceFields.vatRatePercent.safeParse(rate).success).toBe(false)
    }
  })

  it("says what is wrong in plain words", () => {
    expect(vatChoiceFields.vatRatePercent.safeParse("seven").error!.issues[0].message)
      .toBe("Type the VAT % as a number with up to two decimals, like 7.5")
    expect(vatChoiceFields.vatRatePercent.safeParse("101").error!.issues.at(-1)!.message)
      .toBe("VAT cannot be more than 100%")
  })
})

describe("requireManualRate", () => {
  const refine = (line: { vatMethod?: "CODE" | "MANUAL"; vatRatePercent?: string }) => {
    const issues: { message: string; path: (string | number)[] }[] = []
    requireManualRate(line, { addIssue: (i: { message: string; path: (string | number)[] }) => issues.push(i) } as never)
    return issues
  }

  it("refuses a typed rate with no rate, and says what to do", () => {
    expect(refine({ vatMethod: "MANUAL" })).toEqual([
      { code: "custom", message: MANUAL_RATE_MISSING, path: ["vatRatePercent"] },
    ])
    expect(MANUAL_RATE_MISSING).toBe("Type the VAT %, or choose a VAT code.")
  })

  it("accepts a typed rate of zero, which is a rate", () => {
    expect(refine({ vatMethod: "MANUAL", vatRatePercent: "0" })).toEqual([])
  })

  it("accepts a code line whether or not it carries a rate", () => {
    expect(refine({ vatMethod: "CODE" })).toEqual([])
    expect(refine({ vatMethod: "CODE", vatRatePercent: "5" })).toEqual([])
  })
})
