import { describe, expect, it } from "vitest"

import { quoteSchema, skipReasonSchema } from "./quote.validators"

describe("quoteSchema", () => {
  it("takes an amount and a date, and turns blank extras into null", () => {
    expect(quoteSchema.parse({ amount: "1200000", quotedOn: "2026-10-03", reference: " ", note: "" })).toEqual({
      amount: "1200000", quotedOn: "2026-10-03", reference: null, note: null,
    })
  })

  it("trims the quote number and note", () => {
    expect(quoteSchema.parse({ amount: "5", quotedOn: "2026-10-03", reference: " BS-Q-0012 ", note: " 10% off " })).toMatchObject({
      reference: "BS-Q-0012", note: "10% off",
    })
  })

  it("needs the amount and the date", () => {
    expect(quoteSchema.safeParse({ quotedOn: "2026-10-03" }).success).toBe(false)
    expect(quoteSchema.safeParse({ amount: "5" }).success).toBe(false)
    expect(quoteSchema.safeParse({ amount: "abc", quotedOn: "2026-10-03" }).error?.issues[0].message).toBe(
      "Enter an amount with up to two decimal places",
    )
  })

  it("refuses a long note", () => {
    expect(quoteSchema.safeParse({ amount: "5", quotedOn: "2026-10-03", note: "x".repeat(301) }).error?.issues[0].message).toBe(
      "Keep the note under 300 characters.",
    )
  })
})

describe("skipReasonSchema", () => {
  it("needs a reason", () => {
    expect(skipReasonSchema.safeParse("  ").error?.issues[0].message).toBe("Write why there is no quote yet.")
    expect(skipReasonSchema.parse(" OEM price next week ")).toBe("OEM price next week")
  })
})
