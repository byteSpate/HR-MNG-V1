import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./statements.balances", async () => {
  const actual = await vi.importActual<typeof import("./statements.balances")>(
    "./statements.balances"
  )
  return {
    ...actual,
    balancesFor: vi.fn(),
    loadChart: vi.fn(),
    assertLedgerBalanced: vi.fn(async () => undefined),
  }
})

import { Prisma } from "../../generated/prisma/client"
import { utcDate } from "../accounting/accounting.utils"
import { balancesFor, loadChart } from "./statements.balances"
import { buildEquity } from "./statements.equity"

const D = (v: string | number) => new Prisma.Decimal(v)

const ACCOUNTS = [
  { id: "e-root", code: "3000", name: "Equity", type: "EQUITY", parentId: null, isGroup: true, isActive: true, systemRole: null },
  { id: "cap", code: "3100", name: "Share Capital", type: "EQUITY", parentId: "e-root", isGroup: false, isActive: true, systemRole: null },
  { id: "money", code: "3200", name: "Share Money Deposit", type: "EQUITY", parentId: "e-root", isGroup: false, isActive: true, systemRole: null },
  { id: "retained", code: "3300", name: "Retained Earnings", type: "EQUITY", parentId: "e-root", isGroup: false, isActive: true, systemRole: "RETAINED_EARNINGS" },
  // Under their roled section groups, as the seeded chart has them. A leaf
  // parented straight onto 4000 or 5000 is in the trial balance and in no
  // statement section, which `assertChartCoversLedger` refuses.
  { id: "i-root", code: "4000", name: "Income", type: "INCOME", parentId: null, isGroup: true, isActive: true, systemRole: null },
  { id: "rev-grp", code: "4100", name: "Revenue", type: "INCOME", parentId: "i-root", isGroup: true, isActive: true, systemRole: "REVENUE" },
  { id: "rev", code: "4110", name: "Service Revenue", type: "INCOME", parentId: "rev-grp", isGroup: false, isActive: true, systemRole: null },
  { id: "x-root", code: "5000", name: "Expenses", type: "EXPENSE", parentId: null, isGroup: true, isActive: true, systemRole: null },
  { id: "admin", code: "5200", name: "Administrative & Selling Expenses", type: "EXPENSE", parentId: "x-root", isGroup: true, isActive: true, systemRole: "ADMIN_SELLING" },
  { id: "sal", code: "5201", name: "Salary and Allowances", type: "EXPENSE", parentId: "admin", isGroup: false, isActive: true, systemRole: null },
]

function chartIndex() {
  const byId = new Map(ACCOUNTS.map((a) => [a.id, a]))
  const byRole = new Map(ACCOUNTS.filter((a) => a.systemRole).map((a) => [a.systemRole!, a]))
  const childrenOf = (id: string) => ACCOUNTS.filter((a) => a.parentId === id)
  const leavesUnder = (id: string): any[] => {
    const root = byId.get(id)
    if (!root) return []
    if (!root.isGroup) return [root]
    return childrenOf(id).flatMap((c) => leavesUnder(c.id))
  }
  return { all: ACCOUNTS, byId, byRole, childrenOf, leavesUnder, equityRoot: byId.get("e-root") }
}

function balanceMap(entries: Record<string, string>) {
  const map = new Map()
  for (const [id, signed] of Object.entries(entries)) {
    map.set(id, { debit: D(0), credit: D(0), signed: D(signed) })
  }
  return map
}

const range = { from: utcDate(2024, 7, 1), to: utcDate(2025, 6, 30) }

/**
 * balancesFor is called three times:
 *   - opening    — cumulative to the day before `from`, closing included
 *   - movement   — within the range, closing EXCLUDED; feeds both the
 *                  movement rows and the profit row, which is why they can
 *                  never disagree
 *   - cumulative — to `range.to`, closing included, for the chart guard only
 *
 * Keyed on the arguments rather than on call order. The movement map holds
 * the equity movements *and* the profit-and-loss movements together, because
 * that is what one query over a period actually returns — the old fixture
 * fed the profit a separate map, which no ledger could produce.
 */
function mockCalls(opening: any, movement: any) {
  ;(balancesFor as any).mockReset()
  ;(balancesFor as any).mockImplementation(async (opts: any) => {
    if (opts.from !== undefined) return balanceMap(movement)
    return opts.to.getTime() === range.to.getTime() ? balanceMap(movement) : balanceMap(opening)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(loadChart as any).mockResolvedValue(chartIndex())
  // The audited FY2024-25: nothing opening, 1,000,000 share capital issued,
  // a 256,935 loss.
  mockCalls({}, { cap: "1000000.00", sal: "256935.00" })
})

describe("buildEquity", () => {
  it("uses the children of the equity root as columns, in code order", async () => {
    const result = await buildEquity(range)

    expect(result.columns.map((c) => c.code)).toEqual(["3100", "3200", "3300"])
  })

  it("reproduces the audited FY2024-25 statement", async () => {
    const result = await buildEquity(range)

    expect(result.rows.map((r) => r.kind)).toEqual(["OPENING", "MOVEMENT", "PROFIT", "CLOSING"])

    const [opening, movement, profit, closing] = result.rows
    expect(opening.total).toBe("0.00")
    expect(movement.label).toBe("Share Capital")
    expect(movement.values.cap).toBe("1000000.00")
    expect(profit.values.retained).toBe("-256935.00")
    expect(closing.values.cap).toBe("1000000.00")
    expect(closing.values.retained).toBe("-256935.00")
    expect(closing.total).toBe("743065.00")
  })

  it("labels a movement row with the account name, never with an invented event", async () => {
    const result = await buildEquity(range)
    const movement = result.rows.find((r) => r.kind === "MOVEMENT")!

    // Not "Share capital issued" — the system cannot know whether a credit
    // to Share Capital was an issue, a bonus issue or a correction.
    expect(movement.label).toBe("Share Capital")
  })

  it("emits one movement row per account that moved", async () => {
    mockCalls({}, { cap: "1000000.00", money: "250000.00" })

    const result = await buildEquity(range)
    const movements = result.rows.filter((r) => r.kind === "MOVEMENT")

    expect(movements.map((r) => r.label)).toEqual(["Share Capital", "Share Money Deposit"])
  })

  it("emits no movement row when nothing moved", async () => {
    mockCalls({ cap: "1000000.00" }, { sal: "50000.00" })

    const result = await buildEquity(range)

    expect(result.rows.filter((r) => r.kind === "MOVEMENT")).toHaveLength(0)
    expect(result.rows.map((r) => r.kind)).toEqual(["OPENING", "PROFIT", "CLOSING"])
  })

  it("closes at opening plus movements plus profit, per column and in total", async () => {
    mockCalls({ cap: "1000000.00", retained: "-100000.00" }, { money: "50000.00", sal: "40000.00" })

    const result = await buildEquity(range)
    const closing = result.rows.find((r) => r.kind === "CLOSING")!

    expect(closing.values.cap).toBe("1000000.00")
    expect(closing.values.money).toBe("50000.00")
    expect(closing.values.retained).toBe("-140000.00")
    expect(closing.total).toBe("910000.00")
  })

  it("carries a loss booked earlier in the year into the opening Retained Earnings, so it ties to the balance sheet", async () => {
    // October: 10,00,000 of capital, a 1,20,000 salary expense booked before the
    // period and not yet closed, and 11,800 of profit inside the period.
    mockCalls({ cap: "1000000.00", sal: "120000.00" }, { rev: "11800.00" })

    const result = await buildEquity(range)
    const opening = result.rows.find((r) => r.kind === "OPENING")!
    const closing = result.rows.find((r) => r.kind === "CLOSING")!

    expect(opening.values.retained).toBe("-120000.00")
    expect(opening.total).toBe("880000.00")
    expect(closing.values.retained).toBe("-108200.00")
    // Equal to the balance sheet: capital plus all profit since the books began.
    expect(closing.total).toBe("891800.00")
  })

  it("adds nothing to the opening when the earlier year was already closed", async () => {
    // A closed year leaves its income and expense accounts at zero, and the
    // result is already in Retained Earnings.
    mockCalls({ cap: "1000000.00", retained: "-100000.00" }, { sal: "40000.00" })

    const result = await buildEquity(range)
    const opening = result.rows.find((r) => r.kind === "OPENING")!

    expect(opening.values.retained).toBe("-100000.00")
    expect(opening.total).toBe("900000.00")
  })

  it("puts the profit only in the Retained Earnings column", async () => {
    const result = await buildEquity(range)
    const profit = result.rows.find((r) => r.kind === "PROFIT")!

    expect(profit.values.cap).toBe("0.00")
    expect(profit.values.money).toBe("0.00")
    expect(profit.values.retained).toBe("-256935.00")
  })

  it("reads the opening balance to the day before the period starts", async () => {
    await buildEquity(range)

    const opening = (balancesFor as any).mock.calls[0][0]
    expect(opening.from).toBeUndefined()
    expect(opening.to).toEqual(utcDate(2024, 6, 30))
    expect(opening.excludeClosing).toBe(false)
  })

  it("excludes CLOSING journals from the movement rows so the profit is not counted twice", async () => {
    await buildEquity(range)

    const movement = (balancesFor as any).mock.calls[1][0]
    expect(movement.from).toEqual(utcDate(2024, 7, 1))
    expect(movement.to).toEqual(utcDate(2025, 6, 30))
    expect(movement.excludeClosing).toBe(true)
  })

  it("carries no comparative — the statement is self-comparative", async () => {
    const result = await buildEquity(range)

    expect(result).not.toHaveProperty("comparative")
  })
})
