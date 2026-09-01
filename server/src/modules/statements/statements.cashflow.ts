import { Prisma } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { formatBdt } from "../accounting/accounting.utils"
import {
  assertChartCoversLedger, assertEveryAccountClassified, assertLedgerBalanced, balancesFor,
  loadChart, ZERO, type BalanceMap, type ChartAccount, type ChartIndex,
} from "./statements.balances"
import { assertValidRange, describeRange, shiftBackOneYear, type DateRange } from "./statements.period"
import { pnlNetProfit } from "./statements.pnl"
import { cashFlowContribution, movementOf } from "./statements.refs"
import type { CashFlowResult, CashFlowRow } from "./statements.types"

const two = (d: Prisma.Decimal) => d.toFixed(2)
const dayBefore = (date: Date) => new Date(date.getTime() - 24 * 60 * 60 * 1000)
interface Side { movement: BalanceMap; pnl: BalanceMap; opening: BalanceMap; firstDayOpening: BalanceMap; profit: Prisma.Decimal }

async function loadSide(range: DateRange, chart: ChartIndex): Promise<Side> {
  const [movement, pnl, opening, firstDayOpening] = await Promise.all([
    balancesFor({ from: range.from, to: range.to, excludeClosing: false, excludeOpening: true }),
    balancesFor({ from: range.from, to: range.to, excludeClosing: true, excludeOpening: true }),
    balancesFor({ to: dayBefore(range.from), excludeClosing: false }),
    balancesFor({ from: range.from, to: range.from, excludeClosing: false, onlyOpening: true }),
  ])
  assertEveryAccountClassified(chart, movement)
  return { movement, pnl, opening, firstDayOpening, profit: pnlNetProfit(chart, pnl) }
}

const of = (chart: ChartIndex, kind: string): ChartAccount[] => chart.all.filter((a) => !a.isGroup && a.cashFlowKind === kind).sort((a, b) => a.code.localeCompare(b.code))
const cashIn = (chart: ChartIndex, balances: BalanceMap) => of(chart, "CASH").reduce((t, a) => t.plus(movementOf(balances, a.id)), ZERO)

export function assertCashReconciles(computed: Prisma.Decimal, fromCashAccounts: Prisma.Decimal, column: "current" | "comparative" = "current"): void {
  if (computed.equals(fromCashAccounts)) return
  const difference = computed.minus(fromCashAccounts).abs()
  const which = column === "current" ? "" : " in the comparative column"
  throw new AppError(409, `The Statement of Cash Flows does not reconcile${which}: the sections total ${formatBdt(computed)} against a movement of ${formatBdt(fromCashAccounts)} on the cash and bank accounts, a difference of ${formatBdt(difference)}. An account is classified into the wrong cash-flow section, or on the wrong side.`, { column, computed: two(computed), fromCashAccounts: two(fromCashAccounts), difference: two(difference) })
}

export async function cashFlowStatement(range: DateRange): Promise<CashFlowResult> {
  assertValidRange(range)
  await assertLedgerBalanced(range.to)
  const chart = await loadChart()
  assertChartCoversLedger(chart, await balancesFor({ to: range.to, excludeClosing: false }))
  const comparativeRange = shiftBackOneYear(range)
  const [current, comparative] = await Promise.all([loadSide(range, chart), loadSide(comparativeRange, chart)])
  const row = (key: string, label: string, pick: (side: Side) => Prisma.Decimal, isSubtotal = false): CashFlowRow => ({ key, label, current: two(pick(current)), comparative: two(pick(comparative)), ...(isSubtotal ? { isSubtotal: true } : {}) })
  const addBack = (side: Side) => of(chart, "NON_CASH_ADDBACK").reduce((t, a) => t.plus(movementOf(side.pnl, a.id)), ZERO)
  const operatingBeforeWc = (s: Side) => s.profit.plus(addBack(s))
  const wcAccounts = of(chart, "OPERATING_WC")
  const wcContribution = (s: Side, a: ChartAccount) => cashFlowContribution(a.type, movementOf(s.movement, a.id))
  const wcTotal = (s: Side) => wcAccounts.reduce((t, a) => t.plus(wcContribution(s, a)), ZERO)
  const netOperating = (s: Side) => operatingBeforeWc(s).plus(wcTotal(s))
  const workingCapitalLabel = (a: ChartAccount) => a.type === "LIABILITY" || a.type === "EQUITY" ? `Increase/(Decrease) in ${a.name}` : `(Increase)/Decrease in ${a.name}`
  const operating = [row("NET_PROFIT", "Net Profit/(Loss) After Tax", (s) => s.profit), row("DEPRECIATION", "Add: Depreciation", addBack), row("OP_BEFORE_WC", "Operating profit before working capital changes", operatingBeforeWc, true), ...wcAccounts.map((a) => row(`WC_${a.id}`, workingCapitalLabel(a), (s) => wcContribution(s, a))).filter((r) => r.current !== "0.00" || r.comparative !== "0.00"), row("NET_OPERATING", "Net cash generated from operating activities", netOperating, true)]
  const investingAccounts = of(chart, "INVESTING")
  const investingContribution = (s: Side, a: ChartAccount) => cashFlowContribution(a.type, movementOf(s.movement, a.id))
  const netInvesting = (s: Side) => investingAccounts.reduce((t, a) => t.plus(investingContribution(s, a)), ZERO)
  const investing = [...investingAccounts.map((a) => row(`INV_${a.id}`, `Acquisition of ${a.name}`, (s) => investingContribution(s, a))).filter((r) => r.current !== "0.00" || r.comparative !== "0.00"), row("NET_INVESTING", "Net cash used in investing activities", netInvesting, true)]
  const financingAccounts = of(chart, "FINANCING")
  const financingContribution = (s: Side, a: ChartAccount) => cashFlowContribution(a.type, movementOf(s.movement, a.id))
  const netFinancing = (s: Side) => financingAccounts.reduce((t, a) => t.plus(financingContribution(s, a)), ZERO)
  const financing = [...financingAccounts.map((a) => row(`FIN_${a.id}`, `Proceeds from ${a.name}`, (s) => financingContribution(s, a))).filter((r) => r.current !== "0.00" || r.comparative !== "0.00"), row("NET_FINANCING", "Net cash from financing activities", netFinancing, true)]
  const netChange = (s: Side) => netOperating(s).plus(netInvesting(s)).plus(netFinancing(s))
  const openingCash = (s: Side) => cashIn(chart, s.opening).plus(cashIn(chart, s.firstDayOpening))
  const closingCash = (s: Side) => openingCash(s).plus(netChange(s))
  // Both columns. The comparative's closing cash is derived as opening plus
  // net change and never read back, so leaving it unchecked prints a figure
  // nothing has agreed against — in the column an auditor reads first.
  assertCashReconciles(netChange(current), cashIn(chart, current.movement), "current")
  assertCashReconciles(netChange(comparative), cashIn(chart, comparative.movement), "comparative")
  const summary = [row("NET_CHANGE", "Net increase/(decrease) in cash and cash equivalents", netChange, true), row("OPENING_CASH", "Cash and cash equivalents at the beginning of the year", openingCash), row("CLOSING_CASH", "Cash and cash equivalents at the end of the year", closingCash, true)]
  return { period: { from: range.from.toISOString(), to: range.to.toISOString(), label: describeRange(range) }, comparativePeriod: { from: comparativeRange.from.toISOString(), to: comparativeRange.to.toISOString(), label: describeRange(comparativeRange) }, operating, investing, financing, summary }
}
