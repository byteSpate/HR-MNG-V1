import { describe, expect, it } from "vitest"
import { resolveAccountCode } from "./posting.rules"
import { POSTING_RULES, REQUIRED_KEYS } from "./posting.rules.seed"
import { POSTING_EVENTS } from "./posting.types"
import type { ResolvedRules } from "./posting.types"
const rules = (entries: Array<[string, string]>): ResolvedRules => ({ event: "PAYROLL_ACCRUAL", byKey: new Map(entries) })
describe("resolveAccountCode", () => {
  it("uses exact, prefix, then bare fallback", () => { const r = rules([["DIRECT:BASIC", "5122"], ["DIRECT:*", "5199"], ["*", "5201"]]); expect(resolveAccountCode(r, "DIRECT:BASIC")).toBe("5122"); expect(resolveAccountCode(r, "DIRECT:OVERTIME")).toBe("5199"); expect(resolveAccountCode(r, "OTHER:X")).toBe("5201") })
  it("does not route deductions to earnings", () => { const r = rules([["DEDUCTION:*", "2132"], ["*", "5201"]]); expect(resolveAccountCode(r, "DEDUCTION:PF")).toBe("2132") })
  it("throws naming an unresolved event and key", () => { expect(() => resolveAccountCode(rules([]), "BANK")).toThrow(/PAYROLL_ACCRUAL.*BANK/) })
})

describe("posting rule defaults", () => {
  it("provides a settlement account for each required cost nature", () => {
    for (const key of REQUIRED_KEYS.SETTLEMENT_ACCRUAL) {
      if (key.endsWith(":BASIC")) {
        expect(POSTING_RULES).toContainEqual(expect.objectContaining({ event: "SETTLEMENT_ACCRUAL", key }))
      }
    }
  })
})

describe("asset posting rules", () => {
  it("seeds every key the asset events require", () => {
    for (const event of ["ASSET_ACQUISITION", "ASSET_PAYMENT", "ASSET_DEPRECIATION", "ASSET_DISPOSAL"] as const) {
      expect(POSTING_EVENTS).toContain(event)
      for (const key of REQUIRED_KEYS[event]) {
        expect(POSTING_RULES.some((r) => r.event === event && r.key === key)).toBe(true)
      }
    }
  })

  /**
   * Spec Decision 2. A chair capitalised as a laptop is invisible until
   * Annexure-A is read by somebody who knows the company, so an unmapped
   * category must stop rather than land on a default.
   */
  it("gives ASSET_ACQUISITION no bare wildcard", () => {
    expect(POSTING_RULES.some((r) => r.event === "ASSET_ACQUISITION" && r.key === "*")).toBe(false)
  })

  /**
   * 4200 Other Income and 5200 Administrative & Selling are groups, and
   * postSystemJournal refuses to post to a group. Every rule must name a leaf.
   */
  it("points the disposal rules at leaf accounts", () => {
    const disposal = POSTING_RULES.filter((r) => r.event === "ASSET_DISPOSAL")
    expect(disposal.find((r) => r.key === "GAIN")?.account).toBe("4290")
    expect(disposal.find((r) => r.key === "LOSS")?.account).toBe("5217")
    // Introduced in Task 5, where the need becomes visible: a disposal with
    // proceeds throws at runtime without BANK.
    expect(disposal.find((r) => r.key === "BANK")?.account).toBe("1242")
  })
})

describe("asset recovery posting rules", () => {
  it("gives asset recovery its own key on both collection paths", () => {
    expect(POSTING_RULES).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "SETTLEMENT_ACCRUAL", key: "ASSET_RECOVERY", account: "4290" }),
      expect.objectContaining({ event: "PAYROLL_ACCRUAL", key: "DEDUCTION:ASSET_RECOVERY", account: "4290" }),
    ]))
  })

  /** Regression guard for the mistake this key exists to prevent. */
  it("does not route asset recovery through ADVANCE_RECOVERY", () => {
    const rule = POSTING_RULES.find((r) => r.event === "SETTLEMENT_ACCRUAL" && r.key === "ASSET_RECOVERY")
    expect(rule?.account).not.toBe("1250")
  })
})

describe("receivables & payables posting rules, Phase 1", () => {
  it("resolves every new event's documented keys", () => {
    const byEventKey = new Map(POSTING_RULES.map((r) => [`${r.event}:${r.key}`, r.account]))
    expect(byEventKey.get("SUPPLIER_BILL:PAYABLE")).toBe("2111")
    expect(byEventKey.get("SUPPLIER_BILL:GOODS")).toBe("1214")
    expect(byEventKey.get("SUPPLIER_PAYMENT:BANK")).toBe("1242")
    expect(byEventKey.get("INVOICE:RECEIVABLE")).toBe("1220")
    expect(byEventKey.get("INVOICE:VAT")).toBe("2150")
    expect(byEventKey.get("EARNED:GOODS")).toBe("4130")
    expect(byEventKey.get("EARNED:SERVICE")).toBe("4120")
    expect(byEventKey.get("COST_RELEASE:DELIVERED")).toBe("5121")
    expect(byEventKey.get("RECEIPT:BANK")).toBe("1242")
    expect(byEventKey.get("RECEIPT:VDS")).toBe("1234")
    expect(byEventKey.get("RECEIPT:AIT")).toBe("1235")
    expect(byEventKey.get("CUSTOMER_CREDIT:RECEIVABLE")).toBe("1220")
    expect(byEventKey.get("FX:LOSS")).toBe("5320")
    expect(byEventKey.get("FX:GAIN")).toBe("4220")
  })

  it("keeps 2110 untouched by every new event, so Operating Costs and Assets keep crediting it", () => {
    const newEvents: string[] = [
      "SUPPLIER_BILL", "SUPPLIER_PAYMENT", "SUPPLIER_CREDIT",
      "INVOICE", "EARNED", "COST_RELEASE", "RECEIPT", "CUSTOMER_CREDIT", "FX",
    ]
    const accounts = POSTING_RULES.filter((r) => newEvents.includes(r.event)).map((r) => r.account)
    expect(accounts).not.toContain("2110")
  })
})
