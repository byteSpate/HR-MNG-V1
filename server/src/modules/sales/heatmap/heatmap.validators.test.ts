import { describe, expect, it } from "vitest"

import { levelOf, listEditSchema, listRowSchema, moveSchema, setColourSchema, setScopeSchema } from "./heatmap.validators"

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

describe("list editor bodies", () => {
  it("trims the name and needs one", () => {
    expect(listRowSchema.parse({ title: "  SD-WAN ", note: " " })).toEqual({ title: "SD-WAN", note: null })
    expect(listRowSchema.safeParse({ title: " " }).error?.issues[0].message).toBe("Write a name.")
    expect(listRowSchema.safeParse({ title: "x".repeat(81) }).error?.issues[0].message).toBe("Keep the name under 80 characters.")
    expect(listRowSchema.safeParse({ title: "A", note: "x".repeat(161) }).error?.issues[0].message).toBe("Keep the short line under 160 characters.")
  })
  it("edits only what is sent, keeps an explicit empty line as null, and needs something", () => {
    expect(listEditSchema.parse({ hidden: true })).toEqual({ hidden: true })
    expect(listEditSchema.parse({ title: "Router" })).toEqual({ title: "Router" })
    expect(listEditSchema.parse({ note: "" })).toEqual({ note: null })
    expect(listEditSchema.safeParse({}).error?.issues[0].message).toBe("Nothing to change.")
  })
  it("moves up or down only", () => {
    expect(moveSchema.safeParse({ direction: "LEFT" }).error?.issues[0].message).toBe("Move up or down.")
  })
  it("knows the three levels", () => {
    expect(levelOf("parts")).toBe("parts")
    expect(() => levelOf("cards")).toThrow("That is no longer on the heatmap. Reload the page and try again.")
  })
})
