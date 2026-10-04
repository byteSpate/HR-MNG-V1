import { describe, expect, it } from "vitest"

import { safeText } from "./export.safe"

describe("safeText", () => {
  it("prefixes text that a spreadsheet would run as a formula", () => {
    expect(safeText("=HYPERLINK(\"http://x\")")).toBe("'=HYPERLINK(\"http://x\")")
    expect(safeText("@SUM(A1:A2)")).toBe("'@SUM(A1:A2)")
    expect(safeText("-cmd|' /C calc'!A0")).toBe("'-cmd|' /C calc'!A0")
    expect(safeText("+cmd")).toBe("'+cmd")
    expect(safeText("\tTabbed")).toBe("'\tTabbed")
  })

  it("leaves phone numbers and plain numbers alone", () => {
    expect(safeText("+8801711000000")).toBe("+8801711000000")
    expect(safeText("+1 (555) 010-9999")).toBe("+1 (555) 010-9999")
    expect(safeText("-5")).toBe("-5")
  })

  it("leaves ordinary text and the empty string alone", () => {
    expect(safeText("Acme Ltd")).toBe("Acme Ltd")
    expect(safeText("")).toBe("")
  })
})
