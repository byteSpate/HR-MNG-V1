import { describe, expect, it } from "vitest"

import { setColourSchema, setScopeSchema } from "./heatmap.validators"

describe("setColourSchema", () => {
  it("takes Green and drops any reason", () => {
    expect(setColourSchema.parse({ colour: "GREEN", reason: "old" })).toEqual({ colour: "GREEN", reason: null })
  })
  it("needs a reason for Red, trimmed", () => {
    expect(setColourSchema.safeParse({ colour: "RED", reason: "  " }).error?.issues[0].message).toBe(
      "Write why there is no chance here.",
    )
    expect(setColourSchema.parse({ colour: "RED", reason: " Uses another vendor " })).toEqual({
      colour: "RED",
      reason: "Uses another vendor",
    })
  })
  it("takes NONE to clear the colour", () => {
    expect(setColourSchema.parse({ colour: "NONE" })).toEqual({ colour: "NONE", reason: null })
  })
  it("refuses Yellow and long reasons", () => {
    expect(setColourSchema.safeParse({ colour: "YELLOW" }).success).toBe(false)
    expect(setColourSchema.safeParse({ colour: "RED", reason: "x".repeat(301) }).error?.issues[0].message).toBe(
      "Keep the reason under 300 characters.",
    )
  })
})

describe("setScopeSchema", () => {
  it("takes true or false only", () => {
    expect(setScopeSchema.parse({ inScope: true })).toEqual({ inScope: true })
    expect(setScopeSchema.safeParse({ inScope: "yes" }).error?.issues[0].message).toBe("Tick or untick the part.")
  })
})
