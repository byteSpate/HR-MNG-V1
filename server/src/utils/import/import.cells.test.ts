import { describe, expect, it } from "vitest"
import { z } from "zod"

import { cellText, isValidIsoDate, parseWholeNumber, parseYesNo, zodIssues } from "./import.cells"

describe("cellText", () => {
  it("reads a cell by header in any letter case, trimmed", () => {
    expect(cellText({ costnature: "  DIRECT " }, "costNature")).toBe("DIRECT")
    expect(cellText({}, "missing")).toBe("")
  })
})

describe("isValidIsoDate", () => {
  it("accepts real dates only", () => {
    expect(isValidIsoDate("2026-10-04")).toBe(true)
    expect(isValidIsoDate("2026-02-30")).toBe(false)
    expect(isValidIsoDate("04/10/2026")).toBe(false)
    expect(isValidIsoDate("")).toBe(false)
  })
})

describe("parseWholeNumber", () => {
  it("accepts whole numbers and nothing else", () => {
    expect(parseWholeNumber("30")).toBe(30)
    expect(parseWholeNumber("0")).toBe(0)
    expect(parseWholeNumber("-5")).toBe(-5)
    expect(parseWholeNumber("30.5")).toBeNull()
    expect(parseWholeNumber("thirty")).toBeNull()
    expect(parseWholeNumber("")).toBeNull()
  })
})

describe("parseYesNo", () => {
  it("understands yes and no in the common spellings", () => {
    expect(parseYesNo("Yes")).toEqual({ ok: true, value: true })
    expect(parseYesNo("TRUE")).toEqual({ ok: true, value: true })
    expect(parseYesNo("1")).toEqual({ ok: true, value: true })
    expect(parseYesNo("no")).toEqual({ ok: true, value: false })
    expect(parseYesNo("0")).toEqual({ ok: true, value: false })
    expect(parseYesNo("maybe")).toEqual({ ok: false })
  })
})

describe("zodIssues", () => {
  it("maps each Zod problem to a row issue on its column", () => {
    const result = z.object({ name: z.string().min(1, "A name is required") }).safeParse({ name: "" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(zodIssues(4, result.error)).toEqual([{ rowNumber: 4, column: "name", message: "A name is required" }])
  })
})
