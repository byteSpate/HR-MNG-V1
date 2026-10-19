import { describe, expect, it } from "vitest"

import { levelOf, listEditSchema, listRowSchema, moveSchema, setMarkSchema, setNoteSchema } from "./heatmap.validators"

describe("setMarkSchema", () => {
  it("takes a tick, a cross, or clear", () => {
    expect(setMarkSchema.parse({ mark: "GREEN" })).toEqual({ mark: "GREEN" })
    expect(setMarkSchema.parse({ mark: "RED" })).toEqual({ mark: "RED" })
    expect(setMarkSchema.parse({ mark: "NONE" })).toEqual({ mark: "NONE" })
  })
  it("refuses anything else with a plain sentence", () => {
    expect(setMarkSchema.safeParse({ mark: "YELLOW" }).error?.issues[0].message).toBe(
      "Choose a tick, a cross, or clear it.",
    )
    expect(setMarkSchema.safeParse({}).success).toBe(false)
  })
})

describe("setNoteSchema", () => {
  it("trims the note and keeps it optional", () => {
    expect(setNoteSchema.parse({ note: " Uses another vendor " })).toEqual({ note: "Uses another vendor" })
  })
  it("turns an empty or missing note into null, which removes it", () => {
    expect(setNoteSchema.parse({ note: "  " })).toEqual({ note: null })
    expect(setNoteSchema.parse({ note: null })).toEqual({ note: null })
    expect(setNoteSchema.parse({})).toEqual({ note: null })
  })
  it("refuses a long note", () => {
    expect(setNoteSchema.safeParse({ note: "x".repeat(301) }).error?.issues[0].message).toBe(
      "Keep the note under 300 characters.",
    )
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
