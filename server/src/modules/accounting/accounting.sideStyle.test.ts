import { describe, expect, it } from "vitest"

import { shownSides } from "./accounting.sideStyle"

describe("shownSides", () => {
  it("bank style shows the stored credit as the debit, and the stored debit as the credit", () => {
    expect(shownSides("5", "3", "bank")).toEqual({ debit: "3", credit: "5" })
  })

  it("books style shows the sides as stored", () => {
    expect(shownSides("5", "3", "books")).toEqual({ debit: "5", credit: "3" })
  })

  it("keeps an empty side empty", () => {
    expect(shownSides("5", null, "bank")).toEqual({ debit: null, credit: "5" })
  })
})
