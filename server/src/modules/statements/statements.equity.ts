/**
 * Statement of Changes in Equity.
 *
 * Columns are the children of the Equity root; rows are opening balance,
 * one row per equity account that moved, the profit for the period, and the
 * closing balance.
 *
 * A movement row is labelled with its **account name**, not with an event.
 * The system cannot know whether a credit to Share Capital was an issue, a
 * bonus issue or a correction, and naming it wrongly on a filed statement is
 * worse than naming it plainly.
 *
 * **Why the CLOSING split is what makes this tie.** Movement rows exclude
 * CLOSING journals; the profit row carries what the closing entry would have
 * moved. In a closed year the Retained Earnings column therefore shows no
 * movement of its own and the profit row accounts for the whole change —
 * while the ledger balance, read with the closing journal included, lands on
 * exactly the same figure by a different route. Task 6 asserts that.
 *
 * The closing row is the computed sum, not the ledger balance, because
 * mid-year they legitimately differ: nothing has posted to Retained Earnings
 * yet, so the ledger shows only the opening figure while the statement must
 * show the profit earned so far. Total equity agrees with the balance sheet
 * either way, since that carries the same derived profit line.
 *
 * **Profit already booked earlier in the same year.** Mid-year, before the
 * year-end entry has run, earlier months' profit or loss still sits in the
 * income and expense accounts, not in Retained Earnings. The opening row adds
 * it to the Retained Earnings column, or a statement that starts after the
 * first month opens too high by exactly that loss and closes away from the
 * balance sheet. Once a year is closed, those accounts are already zero in the
 * opening balances and nothing is added.
 *
 * There is no comparative. A Statement of Changes in Equity is
 * self-comparative — it carries its own opening and closing balances — which
 * is why the audited FY 2024-25 version has no prior-year column either.
 */

import { Prisma } from "../../generated/prisma/client"
import {
  assertChartCoversLedger,
  assertLedgerBalanced,
  balancesFor,
  loadChart,
  sumLeaves,
  ZERO,
  type BalanceMap,
} from "./statements.balances"
import { pnlNetProfit } from "./statements.pnl"
import {
  assertValidRange,
  describeRange,
  type DateRange,
} from "./statements.period"
import type { EquityColumn, EquityResult, EquityRow } from "./statements.types"

const ONE_DAY_MS = 24 * 60 * 60 * 1000

function dayBefore(date: Date): Date {
  return new Date(date.getTime() - ONE_DAY_MS)
}

function row(
  label: string,
  kind: EquityRow["kind"],
  columns: EquityColumn[],
  valueFor: (column: EquityColumn) => Prisma.Decimal
): EquityRow {
  const values: Record<string, string> = {}
  let total = ZERO
  for (const column of columns) {
    const value = valueFor(column)
    values[column.accountId] = value.toFixed(2)
    total = total.plus(value)
  }
  return { label, kind, values, total: total.toFixed(2) }
}

export async function buildEquity(range: DateRange): Promise<EquityResult> {
  assertValidRange(range)
  await assertLedgerBalanced(range.to)

  const chart = await loadChart()
  const equityRoot = chart.equityRoot

  const columns: EquityColumn[] = equityRoot
    ? chart.childrenOf(equityRoot.id).map((a) => ({ accountId: a.id, code: a.code, name: a.name }))
    : []

  // Two reads that the statement is built from — the second, excluding
  // CLOSING, is the reason this ties — plus a cumulative one the chart guard
  // needs, since a movement-shaped check would miss an account whose activity
  // is all in prior periods.
  const [opening, movement, cumulative] = await Promise.all([
    balancesFor({ to: dayBefore(range.from), excludeClosing: false }),
    balancesFor({ from: range.from, to: range.to, excludeClosing: true }),
    balancesFor({ to: range.to, excludeClosing: false }),
  ])

  assertChartCoversLedger(chart, cumulative)

  // The profit row reads the same balances the movement rows do: both must
  // exclude CLOSING, or the year-end entry is counted on both sides.
  const profit = pnlNetProfit(chart, movement)
  const retained = chart.byRole.get("RETAINED_EARNINGS")

  // Profit or loss booked before this period and not yet closed into Retained
  // Earnings. The opening balances include any CLOSING journal, so for a closed
  // year the income and expense accounts are zero here and this adds nothing.
  const openingProfit = pnlNetProfit(chart, opening)

  const openingIn = (column: EquityColumn) => {
    const base = sumLeaves(chart, opening, column.accountId)
    return retained && column.accountId === retained.id ? base.plus(openingProfit) : base
  }

  const rows: EquityRow[] = [row(`Balance at ${describeRange({ from: range.from, to: range.from })}`, "OPENING", columns, openingIn)]

  // One row per account that actually moved. An account that did not move
  // gets no row at all, rather than a row of dashes.
  for (const column of columns) {
    const moved = sumLeaves(chart, movement, column.accountId)
    if (moved.isZero()) continue
    rows.push(
      row(column.name, "MOVEMENT", columns, (c) =>
        c.accountId === column.accountId ? moved : ZERO
      )
    )
  }

  rows.push(
    row("Profit/(Loss) for the period", "PROFIT", columns, (c) =>
      retained && c.accountId === retained.id ? profit : ZERO
    )
  )

  // Computed, not read back from the ledger — see the file comment.
  rows.push(
    row(`Balance at ${describeRange({ from: range.to, to: range.to })}`, "CLOSING", columns, (c) => {
      const base = openingIn(c).plus(sumLeaves(chart, movement, c.accountId))
      return retained && c.accountId === retained.id ? base.plus(profit) : base
    })
  )

  return {
    period: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      label: describeRange(range),
    },
    columns,
    rows,
  }
}
