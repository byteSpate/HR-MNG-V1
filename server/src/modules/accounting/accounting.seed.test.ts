import { describe, expect, it } from "vitest"

import { CHART } from "./accounting.seed"
import { validateAccountCode } from "./accounting.utils"

describe("CHART", () => {
  it("gives every account a code whose first digit matches its type", () => {
    for (const entry of CHART) {
      expect(() => validateAccountCode(entry.code, entry.type)).not.toThrow()
    }
  })

  it("has no duplicate codes", () => {
    const codes = CHART.map((e) => e.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it("lists every parent before its children, so a single ordered pass can create them", () => {
    const seen = new Set<string>()
    for (const entry of CHART) {
      if (entry.parent) expect(seen.has(entry.parent)).toBe(true)
      seen.add(entry.code)
    }
  })

  it("only ever parents an account to a group", () => {
    const groups = new Set(CHART.filter((e) => e.isGroup).map((e) => e.code))
    for (const entry of CHART) {
      if (entry.parent) expect(groups.has(entry.parent)).toBe(true)
    }
  })

  it("never puts a child under a parent of a different type", () => {
    const typeByCode = new Map(CHART.map((e) => [e.code, e.type]))
    for (const entry of CHART) {
      if (entry.parent) expect(typeByCode.get(entry.parent)).toBe(entry.type)
    }
  })

  it("defines each system role exactly once", () => {
    const roles = CHART.map((e) => e.systemRole).filter(Boolean)
    expect(new Set(roles).size).toBe(roles.length)
  })

  it("carries the thirteen roles the statements and year-end depend on", () => {
    const roles = new Set(CHART.map((e) => e.systemRole).filter(Boolean))

    for (const role of [
      "NON_CURRENT_ASSETS",
      "CURRENT_ASSETS",
      "CURRENT_LIABILITIES",
      "NON_CURRENT_LIABILITIES",
      "PPE_COST",
      "PPE_ACCUM_DEP",
      "REVENUE",
      "OTHER_INCOME",
      "COST_OF_SALES",
      "ADMIN_SELLING",
      "FINANCIAL_EXPENSE",
      "TAX_EXPENSE",
      "RETAINED_EARNINGS",
    ]) {
      expect(roles).toContain(role)
    }
  })

  it("puts RETAINED_EARNINGS on a leaf, since year-end posts to it", () => {
    const retained = CHART.find((e) => e.systemRole === "RETAINED_EARNINGS")!
    expect(retained.isGroup).toBe(false)
  })

  it("puts every other role on a group, since those carry the statement structure", () => {
    for (const entry of CHART) {
      if (entry.systemRole && entry.systemRole !== "RETAINED_EARNINGS") {
        expect(entry.isGroup).toBe(true)
      }
    }
  })

  it("tags exactly one cash account and at least one bank account", () => {
    expect(CHART.filter((e) => e.cashKind === "CASH")).toHaveLength(1)
    expect(CHART.filter((e) => e.cashKind === "BANK").length).toBeGreaterThanOrEqual(1)
  })

  it("never tags a group as cash or bank — a book must render postable lines", () => {
    for (const entry of CHART) {
      if (entry.cashKind && entry.cashKind !== "NONE") expect(entry.isGroup).toBe(false)
    }
  })

  it("reproduces the four-way expense split the audited P&L uses", () => {
    const groups = CHART.filter((e) => e.type === "EXPENSE" && e.isGroup && !e.parent)
    expect(groups.map((g) => g.code).sort()).toEqual(["5000"])

    const blocks = CHART.filter((e) => e.parent === "5000").map((e) => e.name)
    expect(blocks).toEqual([
      "Cost of Goods Sold",
      "Administrative & Selling Expenses",
      "Financial Expenses",
      "Income Tax Expense",
    ])
  })

  it("carries salary in both the direct and the administrative block", () => {
    const salaries = CHART.filter((e) => e.name.toLowerCase().includes("salary"))
    expect(salaries.map((s) => s.code)).toContain("5122")
    expect(salaries.map((s) => s.code)).toContain("5201")
  })
})

describe("cash flow classification", () => {
  const leaves = CHART.filter((e) => !e.isGroup)
  const deliberatelyUnclassified = (code: string, type: string) =>
    code.startsWith("112") || code === "3300" || type === "INCOME" || type === "EXPENSE"

  it("classifies every balance-bearing leaf that is not a deliberate exclusion", () => {
    const missed = leaves.filter(
      (e) => !e.cashFlow && !deliberatelyUnclassified(e.code, e.type)
    )

    expect(missed.map((e) => `${e.code} ${e.name}`)).toEqual([])
  })

  it("marks both depreciation accounts as add-backs", () => {
    expect(leaves.filter((e) => e.cashFlow === "NON_CASH_ADDBACK").map((e) => e.code).sort()).toEqual([
      "5128",
      "5215",
    ])
  })

  it("leaves accumulated depreciation unclassified", () => {
    const accumDep = leaves.filter((e) => e.code.startsWith("112"))
    expect(accumDep.every((e) => !e.cashFlow)).toBe(true)
    expect(accumDep).toHaveLength(4)
  })

  it("leaves Retained Earnings unclassified", () => {
    expect(CHART.find((e) => e.code === "3300")?.cashFlow).toBeUndefined()
  })

  it("classifies only share capital, share money and loans as financing", () => {
    expect(leaves.filter((e) => e.cashFlow === "FINANCING").map((e) => e.code).sort()).toEqual([
      "2210",
      "3100",
      "3200",
    ])
  })

  it("tags exactly the two cash accounts", () => {
    const cash = leaves.filter((e) => e.cashFlow === "CASH")
    expect(cash.map((e) => e.code).sort()).toEqual(["1241", "1242"])
    expect(cash.every((e) => e.cashKind === "CASH" || e.cashKind === "BANK")).toBe(true)
  })
})

describe("note refs", () => {
  it("anchors the filed statement notes", () => {
    const refs = CHART.filter((e) => e.noteRef).map((e) => e.noteRef)
    expect(refs.sort()).toEqual([
      "10.00", "11.00", "12.00", "13.00", "14.00", "15.00", "16.00", "16.01",
      "17.00", "18.00", "19.00", "4.00", "5.00", "6.00", "7.00", "8.00",
      "9.00", "9.01",
    ].sort())
  })

  it("gives no two accounts the same note", () => {
    const refs = CHART.filter((e) => e.noteRef).map((e) => e.noteRef!)
    expect(new Set(refs).size).toBe(refs.length)
  })
})

describe("Annexure-A inputs", () => {
  it("carries the disclosed rate on each PP&E class", () => {
    const rates = Object.fromEntries(CHART.filter((e) => e.rate).map((e) => [e.code, e.rate]))
    expect(rates).toEqual({ "1111": "10.00", "1112": "10.00", "1113": "25.00", "1114": "20.00" })
  })

  it("pairs every PP&E cost account with its accumulated-depreciation account", () => {
    const pairs = Object.fromEntries(CHART.filter((e) => e.contra).map((e) => [e.code, e.contra]))
    expect(pairs).toEqual({ "1111": "1121", "1112": "1122", "1113": "1123", "1114": "1124" })
  })
})

describe("receivables & payables, Phase 1", () => {
  it("includes every new receivables & payables account", () => {
    const codes = CHART.map((c) => c.code)
    expect(codes).toEqual(
      expect.arrayContaining([
        "1214", "1221", "1232", "1233", "1234", "1235",
        "2111", "2160", "2170", "4220", "5129", "5320",
      ])
    )
  })

  it("keeps 2110 and 2111 as siblings under 2100, never colliding", () => {
    const trade = CHART.find((c) => c.code === "2110")
    const suppliers = CHART.find((c) => c.code === "2111")
    expect(trade?.parent).toBe("2100")
    expect(suppliers?.parent).toBe("2100")
    expect(trade?.code).not.toBe(suppliers?.code)
  })
})
