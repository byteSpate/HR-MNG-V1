import { describe, expect, it } from "vitest"
import { Prisma } from "../../generated/prisma/client"
import type { PostingEvent, ResolvedRules } from "../posting/posting.types"
import type { ContractPosition } from "./receivables.position"
import { buildInvoiceLines } from "./invoice.posting"
import { buildEarnedLines } from "./earningEvent.posting"

const d = (v: string) => new Prisma.Decimal(v)

function rulesOf(event: PostingEvent, map: Record<string, string>): ResolvedRules {
  return { event, byKey: new Map(Object.entries(map)) }
}
const INVOICE_RULES = rulesOf("INVOICE", { RECEIVABLE: "1220", VAT: "2150", UNBILLED: "1221", UNEARNED: "2170" })
const EARNED_RULES = rulesOf("EARNED", { GOODS: "4130", SERVICE: "4120", UNBILLED: "1221", UNEARNED: "2170" })

type Line = { accountCode: string; debit?: string; credit?: string; [k: string]: unknown }

function ledger() {
  const bal = new Map<string, Prisma.Decimal>()
  return {
    post(lines: Line[]) {
      for (const l of lines) bal.set(l.accountCode, (bal.get(l.accountCode) ?? d("0")).plus(l.debit ?? "0").minus(l.credit ?? "0"))
    },
    position(): ContractPosition {
      const unbilled = bal.get("1221") ?? d("0")
      const unearned = (bal.get("2170") ?? d("0")).negated()
      return { unbilled: Prisma.Decimal.max(unbilled, d("0")), unearned: Prisma.Decimal.max(unearned, d("0")) }
    },
    // Both builders skip posting an explicit zero line (Task 4/8's own
    // tests require this: `.not.toContain("1221" | "2170")` when a split
    // leaves nothing on that side). That means which of 1221/2170 ever gets
    // touched at all depends on posting order, even though both end up
    // nil either way. "1221"/"2170" are always included, defaulted to nil,
    // so this snapshot compares the position that matters, not which
    // account happened to receive a line.
    snapshot: () => {
      const keys = new Set([...bal.keys(), "1221", "2170"])
      return Object.fromEntries([...keys].map((k) => [k, (bal.get(k) ?? d("0")).toFixed(2)]))
    },
  }
}

const INVOICE = {
  id: "inv1", customerId: "c1", opportunityId: "opp-1", trackDelivery: true,
  lines: [{ amount: d("1000000"), vatAmount: d("150000"), kind: "GOODS" as const }],
}
const EARNED = [{ amount: d("1000000"), kind: "GOODS" as const }]

it("either order ends in the same place, with 1221 and 2170 both nil", () => {
  const a = ledger()
  a.post(buildEarnedLines("opp-1", EARNED, EARNED_RULES, a.position()))
  a.post(buildInvoiceLines(INVOICE, INVOICE_RULES, EARNED_RULES, a.position()))
  const b = ledger()
  b.post(buildInvoiceLines(INVOICE, INVOICE_RULES, EARNED_RULES, b.position()))
  b.post(buildEarnedLines("opp-1", EARNED, EARNED_RULES, b.position()))
  expect(a.snapshot()).toEqual(b.snapshot())
  expect(a.snapshot()["1221"]).toBe("0.00")
  expect(a.snapshot()["2170"]).toBe("0.00")
  expect(a.snapshot()["4130"]).toBe("-1000000.00")
})

it("half delivered, fully invoiced, the rest delivered: only one side is ever non-zero, and both end nil", () => {
  const l = ledger()
  l.post(buildEarnedLines("opp-1", [{ amount: d("500000"), kind: "GOODS" }], EARNED_RULES, l.position()))
  l.post(buildInvoiceLines(INVOICE, INVOICE_RULES, EARNED_RULES, l.position()))
  expect(l.position()).toEqual({ unbilled: d("0"), unearned: d("500000") })
  l.post(buildEarnedLines("opp-1", [{ amount: d("500000"), kind: "GOODS" }], EARNED_RULES, l.position()))
  expect(l.position()).toEqual({ unbilled: d("0"), unearned: d("0") })
})
