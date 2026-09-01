import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    account: { findMany: vi.fn() },
    journalLine: { groupBy: vi.fn(), aggregate: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { Prisma } from "../../generated/prisma/client"
import { utcDate } from "../accounting/accounting.utils"
import {
  assertChartCoversLedger,
  assertEveryAccountClassified,
  assertLedgerBalanced,
  balancesFor,
  isVisible,
  loadChart,
  sumLeaves,
} from "./statements.balances"

const D = (v: string | number) => new Prisma.Decimal(v)

const CHART = [
  { id: "a-root", code: "1000", name: "Assets", type: "ASSET", parentId: null, isGroup: true, isActive: true, systemRole: null },
  { id: "a-cur", code: "1200", name: "Current Assets", type: "ASSET", parentId: "a-root", isGroup: true, isActive: true, systemRole: "CURRENT_ASSETS" },
  { id: "a-cash-grp", code: "1240", name: "Cash & Cash Equivalents", type: "ASSET", parentId: "a-cur", isGroup: true, isActive: true, systemRole: null },
  { id: "a-cash", code: "1241", name: "Cash in Hand", type: "ASSET", parentId: "a-cash-grp", isGroup: false, isActive: true, systemRole: null },
  { id: "a-bank", code: "1242", name: "City Bank", type: "ASSET", parentId: "a-cash-grp", isGroup: false, isActive: true, systemRole: null },
  { id: "e-root", code: "3000", name: "Equity", type: "EQUITY", parentId: null, isGroup: true, isActive: true, systemRole: null },
  { id: "e-cap", code: "3100", name: "Share Capital", type: "EQUITY", parentId: "e-root", isGroup: false, isActive: true, systemRole: null },
]

beforeEach(() => {
  vi.clearAllMocks()
  ;(prisma.account.findMany as any).mockResolvedValue(CHART)
  ;(prisma.journalLine.groupBy as any).mockResolvedValue([])
  ;(prisma.journalLine.aggregate as any).mockResolvedValue({ _sum: { debit: D(0), credit: D(0) } })
})

describe("balancesFor", () => {
  it("includes REVERSED journals and excludes drafts", async () => {
    await balancesFor({ to: utcDate(2026, 7, 31), excludeClosing: false })

    const where = (prisma.journalLine.groupBy as any).mock.calls[0][0].where
    expect(where.journal.status).toEqual({ in: ["POSTED", "REVERSED"] })
  })

  it("filters out CLOSING journals when asked", async () => {
    await balancesFor({ to: utcDate(2026, 7, 31), excludeClosing: true })

    const where = (prisma.journalLine.groupBy as any).mock.calls[0][0].where
    expect(where.journal.type).toEqual({ not: "CLOSING" })
  })

  it("leaves CLOSING journals in when not asked", async () => {
    await balancesFor({ to: utcDate(2026, 7, 31), excludeClosing: false })

    const where = (prisma.journalLine.groupBy as any).mock.calls[0][0].where
    expect(where.journal.type).toBeUndefined()
  })

  it("can exclude OPENING journals from period movements", async () => {
    await balancesFor({ to: utcDate(2026, 7, 31), excludeClosing: true, excludeOpening: true })

    const where = (prisma.journalLine.groupBy as any).mock.calls[0][0].where
    expect(where.journal.type).toEqual({ notIn: ["CLOSING", "OPENING"] })
  })

  it("can load only OPENING journals", async () => {
    await balancesFor({
      from: utcDate(2026, 7, 1),
      to: utcDate(2026, 7, 1),
      excludeClosing: false,
      onlyOpening: true,
    })

    const where = (prisma.journalLine.groupBy as any).mock.calls[0][0].where
    expect(where.journal.type).toBe("OPENING")
  })

  it("runs from inception when `from` is omitted", async () => {
    await balancesFor({ to: utcDate(2026, 7, 31), excludeClosing: false })

    const where = (prisma.journalLine.groupBy as any).mock.calls[0][0].where
    expect(where.journal.date).toEqual({ lte: utcDate(2026, 7, 31) })
  })

  it("bounds both ends when `from` is given", async () => {
    await balancesFor({ from: utcDate(2026, 7, 1), to: utcDate(2026, 7, 31), excludeClosing: true })

    const where = (prisma.journalLine.groupBy as any).mock.calls[0][0].where
    expect(where.journal.date).toEqual({ gte: utcDate(2026, 7, 1), lte: utcDate(2026, 7, 31) })
  })

  it("signs an asset as debit minus credit", async () => {
    ;(prisma.journalLine.groupBy as any).mockResolvedValue([
      { accountId: "a-bank", _sum: { debit: D("1000000.00"), credit: D("385155.00") } },
    ])

    const balances = await balancesFor({ to: utcDate(2026, 7, 31), excludeClosing: false })

    expect(balances.get("a-bank")!.signed.toFixed(2)).toBe("614845.00")
  })

  it("signs equity as credit minus debit", async () => {
    ;(prisma.journalLine.groupBy as any).mockResolvedValue([
      { accountId: "e-cap", _sum: { debit: D(0), credit: D("1000000.00") } },
    ])

    const balances = await balancesFor({ to: utcDate(2026, 7, 31), excludeClosing: false })

    expect(balances.get("e-cap")!.signed.toFixed(2)).toBe("1000000.00")
  })

  it("treats a missing _sum as zero rather than throwing", async () => {
    ;(prisma.journalLine.groupBy as any).mockResolvedValue([
      { accountId: "a-bank", _sum: { debit: null, credit: null } },
    ])

    const balances = await balancesFor({ to: utcDate(2026, 7, 31), excludeClosing: false })

    expect(balances.get("a-bank")!.signed.toFixed(2)).toBe("0.00")
  })
})

describe("loadChart", () => {
  it("indexes accounts by id and by system role", async () => {
    const chart = await loadChart()

    expect(chart.byId.get("a-bank")!.code).toBe("1242")
    expect(chart.byRole.get("CURRENT_ASSETS")!.id).toBe("a-cur")
  })

  it("returns children in code order", async () => {
    const chart = await loadChart()

    expect(chart.childrenOf("a-cash-grp").map((a) => a.code)).toEqual(["1241", "1242"])
  })

  it("walks to leaves through any depth of grouping", async () => {
    const chart = await loadChart()

    expect(chart.leavesUnder("a-root").map((a) => a.code)).toEqual(["1241", "1242"])
  })

  it("treats a leaf as its own single leaf", async () => {
    const chart = await loadChart()

    expect(chart.leavesUnder("a-bank").map((a) => a.code)).toEqual(["1242"])
  })

  it("finds the equity root", async () => {
    const chart = await loadChart()

    expect(chart.equityRoot!.code).toBe("3000")
  })
})

describe("sumLeaves", () => {
  it("adds the signed balances of every leaf under a group", async () => {
    ;(prisma.journalLine.groupBy as any).mockResolvedValue([
      { accountId: "a-cash", _sum: { debit: D("2250.00"), credit: D(0) } },
      { accountId: "a-bank", _sum: { debit: D("612595.00"), credit: D(0) } },
    ])
    const chart = await loadChart()
    const balances = await balancesFor({ to: utcDate(2026, 7, 31), excludeClosing: false })

    expect(sumLeaves(chart, balances, "a-cash-grp").toFixed(2)).toBe("614845.00")
  })

  it("returns zero for a group whose leaves have no balances", async () => {
    const chart = await loadChart()
    const balances = await balancesFor({ to: utcDate(2026, 7, 31), excludeClosing: false })

    expect(sumLeaves(chart, balances, "a-cash-grp").toFixed(2)).toBe("0.00")
  })
})

describe("assertLedgerBalanced", () => {
  it("passes when debit equals credit", async () => {
    ;(prisma.journalLine.aggregate as any).mockResolvedValue({
      _sum: { debit: D("808700.00"), credit: D("808700.00") },
    })

    await expect(assertLedgerBalanced(utcDate(2026, 7, 31))).resolves.toBeUndefined()
  })

  it("409s with both totals and the difference when they disagree", async () => {
    ;(prisma.journalLine.aggregate as any).mockResolvedValue({
      _sum: { debit: D("808700.00"), credit: D("800000.00") },
    })

    await expect(assertLedgerBalanced(utcDate(2026, 7, 31))).rejects.toMatchObject({
      statusCode: 409,
      details: {
        debitTotal: "808700.00",
        creditTotal: "800000.00",
        difference: "8700.00",
      },
    })
  })

  it("checks cumulatively to the end date, not over a range", async () => {
    await assertLedgerBalanced(utcDate(2026, 7, 31))

    const where = (prisma.journalLine.aggregate as any).mock.calls[0][0].where
    expect(where.journal.date).toEqual({ lte: utcDate(2026, 7, 31) })
  })
})

describe("assertChartCoversLedger", () => {
  function balanceMapOf(entries: Record<string, string>) {
    const map = new Map()
    for (const [id, signed] of Object.entries(entries)) {
      map.set(id, { debit: D(0), credit: D(0), signed: D(signed) })
    }
    return map
  }

  it("passes on the seeded chart, where every leaf sits under a section", () => {
    ;(prisma.account.findMany as any).mockResolvedValue(CHART)

    // a-cash / a-bank sit under CURRENT_ASSETS; e-cap under the equity root.
    const chart = {
      byId: new Map(CHART.map((a) => [a.id, a])),
      byRole: new Map([["CURRENT_ASSETS", CHART[1]]]),
      leavesUnder: (id: string) => {
        if (id === "a-cur") return [CHART[3], CHART[4]]
        if (id === "e-root") return [CHART[6]]
        return []
      },
      equityRoot: CHART[5],
    } as never
    const balances = balanceMapOf({ "a-bank": "100.00" })

    expect(() => assertChartCoversLedger(chart, balances)).not.toThrow()
  })

  it("names an account parented directly under the type root", () => {
    // 1300 under 1000 Assets: reachable from a root, reachable from no
    // section, and therefore in the trial balance but in no statement.
    const chart = {
      byId: new Map([["orphan", { id: "orphan", code: "1300", name: "Widget Deposits" }]]),
      byRole: new Map(),
      leavesUnder: () => [],
      equityRoot: { id: "e-root" },
    } as never
    const balances = balanceMapOf({ orphan: "5000.00" })

    expect(() => assertChartCoversLedger(chart, balances)).toThrow(/1300/)
  })

  it("ignores an unreachable account with no balance — an empty account is not a defect", () => {
    const chart = {
      byId: new Map([["orphan", { id: "orphan", code: "1300", name: "Widget Deposits" }]]),
      byRole: new Map(),
      leavesUnder: () => [],
      equityRoot: { id: "e-root" },
    } as never
    const balances = balanceMapOf({})

    expect(() => assertChartCoversLedger(chart, balances)).not.toThrow()
  })

  it("names every orphan at once rather than stopping at the first", () => {
    const chart = {
      byId: new Map([
        ["o1", { id: "o1", code: "1300", name: "Widget Deposits" }],
        ["o2", { id: "o2", code: "1399", name: "Unclassified" }],
      ]),
      byRole: new Map(),
      leavesUnder: () => [],
      equityRoot: { id: "e-root" },
    } as never
    const balances = balanceMapOf({ o1: "100.00", o2: "200.00" })

    expect(() => assertChartCoversLedger(chart, balances)).toThrow(/1300/)
    expect(() => assertChartCoversLedger(chart, balances)).toThrow(/1399/)
  })
})

describe("assertEveryAccountClassified", () => {
  type Row = {
    id: string
    code: string
    name: string
    type: string
    parentId: string | null
    isGroup: boolean
    systemRole: string | null
    cashFlowKind: string
  }

  const account = (over: Partial<Row> & { id: string; code: string }): Row => ({
    name: "Something", type: "ASSET", parentId: null, isGroup: false,
    systemRole: null, cashFlowKind: "NONE", ...over,
  })

  /** A ChartIndex over a flat list, with real recursive `leavesUnder`. */
  function indexOf(rows: Row[]) {
    const byId = new Map(rows.map((r) => [r.id, r]))
    const childrenOf = (id: string) => rows.filter((r) => r.parentId === id)
    const leavesUnder = (id: string): Row[] => {
      const root = byId.get(id)
      if (!root) return []
      return root.isGroup ? childrenOf(id).flatMap((c) => leavesUnder(c.id)) : [root]
    }
    return {
      all: rows,
      byId,
      byRole: new Map(rows.filter((r) => r.systemRole).map((r) => [r.systemRole!, r])),
      byNoteRef: new Map(),
      childrenOf,
      leavesUnder,
      equityRoot: null,
    } as never
  }

  const balances = (entries: Record<string, string>) =>
    new Map(Object.entries(entries).map(([id, signed]) => [id, { debit: D(0), credit: D(0), signed: D(signed) }]))

  it("names an unclassified account carrying a balance", () => {
    const loan = account({ id: "loan", code: "1265", name: "Staff Loan — Vehicles" })

    expect(() => assertEveryAccountClassified(indexOf([loan]), balances({ loan: "40000.00" }))).toThrow(
      /1265 Staff Loan — Vehicles/
    )
  })

  it("passes an unclassified account at nil — nothing of it reaches the statement", () => {
    const loan = account({ id: "loan", code: "1265" })

    expect(() => assertEveryAccountClassified(indexOf([loan]), balances({ loan: "0" }))).not.toThrow()
  })

  it("passes an account that is classified", () => {
    const recv = account({ id: "recv", code: "1220", cashFlowKind: "OPERATING_WC" })

    expect(() => assertEveryAccountClassified(indexOf([recv]), balances({ recv: "40000.00" }))).not.toThrow()
  })

  it("names every unclassified account at once rather than stopping at the first", () => {
    const rows = [account({ id: "a", code: "1265" }), account({ id: "b", code: "1266" })]
    const check = () => assertEveryAccountClassified(indexOf(rows), balances({ a: "1.00", b: "2.00" }))

    expect(check).toThrow(/1265/)
    expect(check).toThrow(/1266/)
  })

  // The three deliberate exclusions of 2b Decision 5. Each is identified
  // structurally — a descendant of PPE_ACCUM_DEP, the RETAINED_EARNINGS
  // account, and type in (INCOME, EXPENSE) — so the guard can tell a
  // deliberate exclusion from a forgotten one with no fourth column
  // recording intent.
  it("excludes accumulated depreciation, whose movement is the add-back from the other side", () => {
    const group = account({ id: "ad", code: "1120", isGroup: true, systemRole: "PPE_ACCUM_DEP" })
    const leaf = account({ id: "ad-f", code: "1121", parentId: "ad" })

    expect(() =>
      assertEveryAccountClassified(indexOf([group, leaf]), balances({ "ad-f": "-29650.00" }))
    ).not.toThrow()
  })

  it("excludes retained earnings, which the profit line at the top already carries", () => {
    const re = account({ id: "re", code: "3300", type: "EQUITY", systemRole: "RETAINED_EARNINGS" })

    expect(() => assertEveryAccountClassified(indexOf([re]), balances({ re: "-256935.00" }))).not.toThrow()
  })

  it("excludes income and expense accounts, which the profit line already carries", () => {
    const rent = account({ id: "rent", code: "5206", type: "EXPENSE" })
    const rev = account({ id: "rev", code: "4110", type: "INCOME" })

    expect(() =>
      assertEveryAccountClassified(indexOf([rent, rev]), balances({ rent: "70500.00", rev: "1000000.00" }))
    ).not.toThrow()
  })

  it("still names a depreciation account if somebody clears its classification", () => {
    // 5128 and 5215 are the exception to the income/expense exclusion: they
    // are the add-back. But they are excluded here by *type*, not by role —
    // so this documents that the guard cannot catch that particular mistake,
    // and assertCashReconciles is what does.
    const dep = account({ id: "dep", code: "5215", type: "EXPENSE", name: "Depreciation — Admin" })

    expect(() => assertEveryAccountClassified(indexOf([dep]), balances({ dep: "29650.00" }))).not.toThrow()
  })
})

/**
 * A source-text assertion, which is unusual and deliberate.
 *
 * `assertChartCoversLedger` shipped fully tested and called from one of the
 * four statements. The defect is *"the call is missing"*, and every
 * behavioural test of a guard needs that guard reachable from the statement —
 * which is exactly the condition that failed. A test that mocks the guard to
 * prove it was called proves only that the mock was called.
 */
describe("the chart guard is wired into every statement", () => {
  it.each(["pnl", "position", "equity", "cashflow"])("is called by statements.%s.ts", (name) => {
    const source = readFileSync(join(__dirname, `statements.${name}.ts`), "utf8")
    expect(source).toMatch(/assertChartCoversLedger\(/)
  })
})

describe("isVisible", () => {
  const active = { id: "x", isActive: true } as never
  const retired = { id: "x", isActive: false } as never

  it("shows an active account even at nil in both periods", () => {
    expect(isVisible(active, D(0), D(0))).toBe(true)
  })

  it("hides a deactivated account with nothing in either period", () => {
    expect(isVisible(retired, D(0), D(0))).toBe(false)
  })

  it("shows a deactivated account that still carries a current balance", () => {
    expect(isVisible(retired, D("100.00"), D(0))).toBe(true)
  })

  it("shows a deactivated account that carried a comparative balance", () => {
    expect(isVisible(retired, D(0), D("100.00"))).toBe(true)
  })
})
