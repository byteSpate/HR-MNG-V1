/**
 * The Finance Officer landing page.
 *
 * The two cards worth reading twice are **run readiness**, which calls
 * `preflight` for a month that has no run yet, and **exchange-rate age**,
 * which replaced a "Disbursed YTD" vanity number with the one figure that
 * silently corrupts every conversion when it goes stale.
 */

import prisma from "../../config/prisma"
import { officeToday } from "../attendance/attendance.time"
import type { AccessTokenPayload } from "../auth/auth.types"
import { REPORTING_CURRENCY, dec, toMoneyString } from "../payroll/payroll.money"
import { monthName } from "../payroll/payroll.events"
import { preflight } from "../payroll/payroll.preflight"
import { listWaitingForApproval } from "../dealMoney/dealMoney.approvals"
import { settleCards } from "./dashboard.cards"
import { ageInDays, bdt, days, money, when } from "./dashboard.format"
import { timeOfDayGreeting } from "./dashboard.greeting"
import { currentPayrollCard } from "./dashboard.payroll-card"
import { payrollSeries } from "./dashboard.series"
import { toneFor } from "./dashboard.tone"
import type { DashboardPayload, DashboardStat, TableCell } from "./dashboard.types"

const BLOCKER_WORDS: Record<string, string> = {
  MONTH_NOT_OVER: "the month has not finished",
  UNAPPROVED_ATTENDANCE: "attendance still awaiting approval",
  MISSING_SALARY_STRUCTURE: "someone has no salary structure",
  MISSING_EXCHANGE_RATE: "an exchange rate is missing",
  NEGATIVE_NET_PAY: "a payslip would come out negative",
}

/** The month about to be run: the previous one, since a run needs it finished. */
function previousMonth(today = officeToday()) {
  const at = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
  return { month: at.getUTCMonth() + 1, year: at.getUTCFullYear() }
}

/**
 * Whether last month can actually be run.
 *
 * `preflight` takes `(month, year)` directly and needs no run to exist, which
 * is the entire point: Finance needs to know a month is blocked *before*
 * opening a run, not after.
 */
async function readinessCard(): Promise<DashboardStat> {
  const { month, year } = previousMonth()
  const report = await preflight(month, year)
  const count = report.blockers.length
  const first = report.blockers[0]

  return {
    label: "Run readiness",
    value: String(count),
    sub:
      count === 0
        ? `${monthName(month, year)} is ready to run`
        : `${monthName(month, year)}: ${BLOCKER_WORDS[first.code] ?? first.code}`,
    tag: count === 0 ? "Ready" : "Blocked",
    tone: toneFor.blockers(count),
    href: "/finance/payroll",
  }
}

/**
 * How old the newest exchange rate is.
 *
 * Displaces "Disbursed YTD": a year-to-date total is a number nobody acts on,
 * while a stale rate silently mis-converts every USD payslip and expense in
 * the run about to be opened.
 */
async function exchangeRateCard(): Promise<DashboardStat> {
  const newest = await prisma.exchangeRate.findFirst({
    orderBy: { effectiveFrom: "desc" },
    select: { base: true, quote: true, rate: true, effectiveFrom: true },
  })

  if (!newest) {
    return {
      label: "Exchange rate",
      // Never "0 days" — zero days old is the healthiest possible reading
      // and the exact opposite of the truth.
      value: "Not set",
      sub: "No rate has ever been recorded",
      tag: "Missing",
      tone: "red",
      href: "/finance/settings",
    }
  }

  const age = ageInDays(newest.effectiveFrom, officeToday())
  return {
    label: "Exchange rate",
    value: `৳${newest.rate.toFixed(2)} / 1 ${newest.base}`,
    sub: age === 0 ? "Set today" : `Set ${days(age)} ago`,
    tag: `${newest.base}→${newest.quote}`,
    tone: toneFor.staleness(age),
    href: "/finance/settings",
  }
}

interface Outstanding {
  count: number
  /** BDT, or null when a claim could not be converted. */
  total: number
  /** Claims left out of the total because no rate covered them. */
  unconverted: number
}

/**
 * Claims that are still owed.
 *
 * `payslipId IS NULL AND settlementId IS NULL` is the whole point: `APPROVED`
 * is not `paid`, and those columns exist precisely so reimbursement is a
 * checkable fact rather than a label. An approved claim a payslip already
 * consumed must not be counted again.
 */
async function outstandingClaims(): Promise<Outstanding> {
  const claims = await prisma.expenseClaim.findMany({
    where: {
      status: { in: ["PENDING", "APPROVED"] },
      payslipId: null,
      settlementId: null,
    },
    select: { amount: true, currency: true, fxRateToBdt: true },
  })

  let total = dec(0)
  let unconverted = 0

  for (const claim of claims) {
    if (claim.currency === REPORTING_CURRENCY) {
      total = total.plus(claim.amount)
      continue
    }
    if (claim.fxRateToBdt) {
      // Its own frozen rate, not today's — that is what the claim is worth.
      total = total.plus(claim.amount.mul(claim.fxRateToBdt))
      continue
    }
    // Not yet approved, so no rate is frozen. Excluded from the sum rather
    // than defaulted to 1.0: a silent 1.0 is a 122× understatement, exactly
    // as it would be in payroll.
    unconverted++
  }

  return { count: claims.length, total: Number(toMoneyString(total)), unconverted }
}

function outstandingCard(outstanding: Outstanding): DashboardStat {
  const { count, total, unconverted } = outstanding
  return {
    label: "Reimbursements outstanding",
    value: String(count),
    sub:
      count === 0
        ? "Nothing owed"
        : unconverted > 0
          ? `${bdt(total)} · ${unconverted} not yet converted`
          : `${bdt(total)} owed`,
    tag: count === 0 ? "Clear" : "Owed",
    tone: toneFor.queue(count),
    href: "/finance/expenses",
  }
}

/**
 * Pending claims, **with a currency column**. `ExpenseClaim.currency` is
 * real, and a USD claim rendered beside a BDT one with no currency shown is
 * a misread waiting to happen.
 */
async function pendingClaimRows(): Promise<TableCell[][]> {
  const claims = await prisma.expenseClaim.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: 5,
    select: {
      amount: true,
      currency: true,
       category: { select: { name: true } },
      expenseDate: true,
      employee: { select: { fullName: true, employeeCode: true } },
    },
  })

  return claims.map((c) => [
    { text: c.employee.fullName, sub: c.employee.employeeCode, weight: 500 },
    { text: c.category.name },
    // No `tag` beside the text: the client's CellBody returns the tag and
    // never reaches the text, so carrying both rendered a bare "BDT" pill and
    // dropped the figure — a money column with no money on the money screen.
    // `money()` already carries the symbol, so the tag was a duplicate anyway.
    { text: money(c.amount, c.currency) },
    { text: when(c.expenseDate) },
  ])
}

function waitingForApprovalCard(count: number): DashboardStat {
  return {
    label: "Waiting for approval",
    value: String(count),
    sub: count === 0 ? "Nothing is waiting" : `${count} draft${count === 1 ? "" : "s"} to approve or send back`,
    tag: count === 0 ? "Clear" : "Waiting",
    tone: toneFor.queue(count),
    href: "/finance/accounting/approvals",
  }
}

export async function buildFinanceDashboard(
  _actor: AccessTokenPayload
): Promise<DashboardPayload> {
  // Fetched once, read by the card and the nav badge (CLAUDE.md: "Nav
  // badges carry no literals").
  const [outstanding, waiting] = await Promise.all([outstandingClaims(), listWaitingForApproval()])

  const [stats, bars, rows] = await Promise.all([
    settleCards([
      { label: "This month's payroll", build: () => currentPayrollCard("/finance/payroll") },
      { label: "Run readiness", build: () => readinessCard() },
      { label: "Exchange rate", build: () => exchangeRateCard() },
      { label: "Reimbursements outstanding", build: async () => outstandingCard(outstanding) },
      { label: "Waiting for approval", build: async () => waitingForApprovalCard(waiting.length) },
    ]),
    payrollSeries(6),
    pendingClaimRows(),
  ])

  return {
    role: "FINANCE_OFFICER",
    greeting: {
      kicker: timeOfDayGreeting(),
      heading: "Payroll and reimbursements",
      sub: "Where this month's run stands, and what is blocking the next one.",
      cta: { label: "Open payroll", href: "/finance/payroll" },
    },
    stats,
    chart: { title: "Payroll disbursed", sub: "Last six months, BDT", bars },
    table: {
      title: "Claims waiting on you",
      headers: ["Employee", "Category", "Amount", "Spent on"],
      rows,
      href: "/finance/expenses",
    },
    badges: { "/finance/expenses": outstanding.count, "/finance/accounting/approvals": waiting.length },
  }
}
