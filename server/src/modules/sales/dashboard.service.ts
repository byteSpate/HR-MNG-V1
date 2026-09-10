/**
 * The Sales Hub landing page, in two bands.
 *
 * **Band 1 is my quarter** — target, achievement, and the money beside the
 * count. **Band 2 is what needs doing**, and it is the half that makes this
 * page operational rather than decorative.
 *
 * Presentation-ready, as every dashboard in this codebase is: the tone is
 * chosen here, from `dashboard.tone.ts`, so a threshold lives in one file
 * rather than in five components that agreed once. The client renders what it
 * is given and decides nothing.
 *
 * Two rows of Band 2 are missing on purpose. *Meetings today* and *Tasks due*
 * read `SalesMeeting` and `SalesTask`, which arrive in phase 3. They are
 * **absent**, not empty: an empty "Tasks due" row reads as "no tasks", which
 * is a number nobody measured. `notBuilt` names them so the page can say so.
 */

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { Role, SalesRole } from "../../generated/prisma/client"
import type { AccessTokenPayload } from "../auth/auth.types"
import { bdt } from "../dashboard/dashboard.format"
import { toneFor } from "../dashboard/dashboard.tone"
import type { DashboardStat } from "../dashboard/dashboard.types"
import { dec, sum, toMoneyString } from "../payroll/payroll.money"
import { employeeIdFor } from "./sales.access"
import { currentQuarter, quarterRange } from "./sales.quarters"
import type {
  SalesActionRow,
  SalesDashboardPayload,
  SalesQuarterRow,
  SalesTeamRow,
} from "./sales.types"

const MS_PER_DAY = 86_400_000

/** Deals quiet for this long need chasing. */
const QUIET_DAYS = 30
/** A deal that has not moved stage in this long is stuck — the reason Stage exists. */
const STUCK_DAYS = 21
/** How far ahead the closing-soon row looks. */
const CLOSING_DAYS = 30

export interface SalesDashboardQuery {
  employeeId?: string
  scope?: "me" | "all"
  /** Injected so a test can pin the quarter. Production passes nothing. */
  now?: Date
}

function isSalesAdmin(actor: AccessTokenPayload): boolean {
  return actor.role === Role.SUPER_ADMIN || actor.salesRole === SalesRole.SALES_ADMIN
}

/** Count and value of a set of deals, with the unpriced ones named rather than zeroed. */
function money(deals: { amount: unknown }[]): { count: number; value: string; unpriced: number } {
  const priced = deals.filter((deal) => deal.amount !== null && deal.amount !== undefined)
  return {
    count: deals.length,
    value: toMoneyString(sum(priced.map((deal) => dec(deal.amount as never)))),
    unpriced: deals.length - priced.length,
  }
}

/**
 * Distinct accounts this person actually did something on, in a window.
 *
 * *Worked on* is an action, so it is counted from actions — a logged
 * communication or an opportunity that moved. An account assigned to somebody
 * and never touched does not count, which is the whole point of the measure
 * (C4): the number says how busy the quarter was, not how long the list is.
 */
async function accountsWorkedOn(
  employeeId: string,
  window?: { gte: Date; lt: Date }
): Promise<number> {
  const [communications, opportunities] = await Promise.all([
    prisma.salesCommunication.findMany({
      where: { employeeId, ...(window ? { occurredAt: window } : {}) },
      select: { salesAccountId: true },
    }),
    prisma.opportunity.findMany({
      where: { ownerEmployeeId: employeeId, ...(window ? { lastActivityAt: window } : {}) },
      select: { salesAccountId: true },
    }),
  ])
  const ids = new Set<string>()
  for (const row of communications) ids.add(row.salesAccountId)
  for (const row of opportunities) ids.add(row.salesAccountId)
  return ids.size
}

/** One person's numbers for one quarter. Shared by the personal view and the roll-up. */
async function figuresFor(employeeId: string, calendarYear: number, quarter: number) {
  const { start, end } = quarterRange(calendarYear, quarter)
  const window = { gte: start, lt: end }

  const [wins, ongoing, lost, cancelled, total] = await Promise.all([
    prisma.opportunity.findMany({
      // `status: WON` as well as `wonByEmployeeId`, because the winner id is
      // never cleared on a reopen — a deal won, reopened and then lost still
      // carries it.
      where: { wonByEmployeeId: employeeId, status: "WON", closedAt: window },
      select: { amount: true },
    }),
    prisma.opportunity.findMany({
      where: { ownerEmployeeId: employeeId, status: "ONGOING" },
      select: { amount: true },
    }),
    prisma.opportunity.count({
      where: { ownerEmployeeId: employeeId, status: "LOST", closedAt: window },
    }),
    prisma.opportunity.count({
      where: { ownerEmployeeId: employeeId, status: "CANCELLED", closedAt: window },
    }),
    prisma.opportunity.count({ where: { ownerEmployeeId: employeeId } }),
  ])

  return { won: money(wins), ongoing: money(ongoing), lost, cancelled, total }
}

/** Band 2. Only rows with a table behind them; see the module comment. */
async function actionRows(employeeId: string, now: Date): Promise<SalesActionRow[]> {
  const closingBy = new Date(now.getTime() + CLOSING_DAYS * MS_PER_DAY)
  const quietBefore = new Date(now.getTime() - QUIET_DAYS * MS_PER_DAY)
  const stuckBefore = new Date(now.getTime() - STUCK_DAYS * MS_PER_DAY)
  const mine = { ownerEmployeeId: employeeId, status: "ONGOING" as const }

  const [closing, unverified, quiet, stuck] = await Promise.all([
    prisma.opportunity.count({
      where: { ...mine, expectedCloseDate: { gte: now, lte: closingBy } },
    }),
    prisma.salesAccount.count({
      where: { ownerEmployeeId: employeeId, contacts: { none: { status: "VERIFIED" } } },
    }),
    prisma.opportunity.count({ where: { ...mine, lastActivityAt: { lt: quietBefore } } }),
    prisma.opportunity.count({ where: { ...mine, stageChangedAt: { lt: stuckBefore } } }),
  ])

  return [
    {
      key: "closing",
      label: `Closing in ${CLOSING_DAYS} days`,
      count: closing,
      detail: closing === 0 ? "Nothing due to close this month" : "Expected to close soon",
      tone: toneFor.queue(closing),
      href: "/opportunities?closing=30",
    },
    {
      key: "unverified",
      label: "Accounts with no verified contact",
      count: unverified,
      detail:
        unverified === 0
          ? "Every account has somebody we have reached"
          : "Nobody has been reached at these yet",
      tone: toneFor.queue(unverified),
      href: "/accounts?unverified=true",
    },
    {
      key: "quiet",
      label: `Quiet for ${QUIET_DAYS}+ days`,
      count: quiet,
      detail: quiet === 0 ? "Every open deal has moved recently" : "No activity recorded",
      tone: toneFor.queue(quiet),
      href: `/opportunities?quiet=${QUIET_DAYS}`,
    },
    {
      key: "stuck",
      label: `Stuck in one stage ${STUCK_DAYS}+ days`,
      count: stuck,
      detail: stuck === 0 ? "Every open deal has changed stage recently" : "Stage has not moved",
      tone: toneFor.queue(stuck),
      href: `/opportunities?stuck=${STUCK_DAYS}`,
    },
  ]
}

/** The roll-up's own four tiles: totals across everybody. */
function teamStats(team: SalesTeamRow[]): DashboardStat[] {
  const achievement = team.reduce((total, row) => total + row.achievement, 0)
  const withTarget = team.filter((row) => row.target !== null)
  const target = withTarget.reduce((total, row) => total + (row.target ?? 0), 0)
  const ongoing = team.reduce((total, row) => total + row.ongoing, 0)

  return [
    {
      label: "Team Achievement",
      value: String(achievement),
      sub: "Deals won this quarter",
      tag: "Won",
      tone: "neutral",
    },
    {
      label: "Team Target",
      // Absent, not zero, when nobody has a target set.
      value: withTarget.length === 0 ? "Not set" : String(target),
      sub:
        withTarget.length === team.length
          ? "Everyone has a target"
          : `${withTarget.length} of ${team.length} have one`,
      tag: "Target",
      tone: "neutral",
    },
    {
      label: "Team Value Won",
      value: bdt(sum(team.map((row) => dec(row.valueWon)))),
      sub: "This quarter",
      tag: "Value",
      tone: "neutral",
    },
    {
      label: "Team Ongoing",
      value: String(ongoing),
      sub: "Open deals across the team",
      tag: "Open",
      tone: "neutral",
    },
  ]
}

export async function getSalesDashboard(
  query: SalesDashboardQuery,
  actor: AccessTokenPayload
): Promise<SalesDashboardPayload> {
  const now = query.now ?? new Date()
  const { calendarYear, quarter } = currentQuarter(now)
  const ownEmployeeId = await employeeIdFor(actor)

  if (query.scope === "all" && !isSalesAdmin(actor)) {
    throw new AppError(403, "Only a Sales Admin can see the whole team")
  }
  if (query.employeeId && query.employeeId !== ownEmployeeId && !isSalesAdmin(actor)) {
    throw new AppError(403, "You can only see your own dashboard")
  }

  // ── the admin roll-up ────────────────────────────────────────────────────
  if (query.scope === "all") {
    const [people, targets] = await Promise.all([
      prisma.employee.findMany({
        where: { user: { salesRole: { not: null } } },
        select: { id: true, fullName: true },
        orderBy: { fullName: "asc" },
      }),
      prisma.salesTarget.findMany({
        where: { calendarYear, quarter },
        select: { employeeId: true, targetDeals: true },
      }),
    ])
    const targetBy = new Map(targets.map((row) => [row.employeeId, row.targetDeals]))

    const team: SalesTeamRow[] = await Promise.all(
      people.map(async (person) => {
        const figures = await figuresFor(person.id, calendarYear, quarter)
        return {
          employeeId: person.id,
          employeeName: person.fullName,
          target: targetBy.get(person.id) ?? null,
          achievement: figures.won.count,
          valueWon: figures.won.value,
          ongoing: figures.ongoing.count,
        }
      })
    )

    return {
      scope: "all",
      employeeId: null,
      employeeName: "Everyone",
      calendarYear,
      quarter,
      stats: teamStats(team),
      quarters: [],
      actions: [],
      team,
      badges: {},
      notBuilt: ["meetings", "tasks"],
    }
  }

  // ── one person ───────────────────────────────────────────────────────────
  const subjectId = query.employeeId ?? ownEmployeeId
  if (!subjectId) {
    throw new AppError(
      400,
      "Your account has no employee record, so it has no sales figures of its own. Choose an employee instead."
    )
  }

  const employee = await prisma.employee.findUnique({
    where: { id: subjectId },
    select: { id: true, fullName: true },
  })
  if (!employee) {
    throw new AppError(404, "That employee does not exist")
  }

  const thisQuarter = quarterRange(calendarYear, quarter)
  const [targets, figures, actions, workedThisQuarter, workedAllTime] = await Promise.all([
    prisma.salesTarget.findMany({
      where: { employeeId: subjectId, calendarYear },
      select: { quarter: true, targetDeals: true },
    }),
    figuresFor(subjectId, calendarYear, quarter),
    actionRows(subjectId, now),
    accountsWorkedOn(subjectId, { gte: thisQuarter.start, lt: thisQuarter.end }),
    accountsWorkedOn(subjectId),
  ])

  const targetBy = new Map(targets.map((row) => [row.quarter, row.targetDeals]))
  const thisTarget = targetBy.get(quarter) ?? null

  const quarters: SalesQuarterRow[] = await Promise.all(
    [1, 2, 3, 4].map(async (q) => {
      const f = q === quarter ? figures : await figuresFor(subjectId, calendarYear, q)
      return {
        quarter: q,
        target: targetBy.get(q) ?? null,
        achievement: f.won.count,
        valueWon: f.won.value,
      }
    })
  )

  const stats: DashboardStat[] = [
    {
      label: "Quarterly Target",
      // "Not set" and not 0: nobody deciding is a different fact from
      // somebody deciding zero.
      value: thisTarget === null ? "Not set" : String(thisTarget),
      sub: `Q${quarter} ${calendarYear}`,
      tag: "Target",
      tone: "neutral",
    },
    {
      label: "Quarterly Achievement",
      value: String(figures.won.count),
      sub: figures.won.unpriced > 0 ? `${figures.won.unpriced} unpriced` : "Deals won and closed",
      tag: "Won",
      tone: "neutral",
    },
    // Rendered only when a target exists. "0 of 0" is a sentence about a
    // decision nobody made.
    ...(thisTarget === null
      ? []
      : [
          {
            label: "Against Target",
            value: `${figures.won.count} of ${thisTarget}`,
            sub: `Q${quarter}`,
            tag: "Progress",
            tone: toneFor.rate(
              thisTarget === 0 ? 100 : (figures.won.count / thisTarget) * 100,
              { good: 100, bad: 50 }
            ),
          } satisfies DashboardStat,
        ]),
    {
      label: "Value Won",
      value: bdt(dec(figures.won.value)),
      sub:
        figures.won.unpriced > 0
          ? `${figures.won.unpriced} won deal${figures.won.unpriced === 1 ? "" : "s"} unpriced`
          : "This quarter",
      tag: "Value",
      tone: "neutral",
    },
    {
      label: "Ongoing",
      value: String(figures.ongoing.count),
      sub:
        figures.ongoing.unpriced > 0
          ? `${bdt(dec(figures.ongoing.value))}, ${figures.ongoing.unpriced} unpriced`
          : bdt(dec(figures.ongoing.value)),
      tag: "Open",
      tone: "neutral",
    },
    { label: "Lost", value: String(figures.lost), sub: `Q${quarter}`, tag: "Lost", tone: "neutral" },
    {
      label: "Cancelled",
      value: String(figures.cancelled),
      sub: `Q${quarter}`,
      tag: "Cancelled",
      tone: "neutral",
    },
    {
      label: "Total Opportunities",
      value: String(figures.total),
      sub: "All time",
      tag: "Total",
      tone: "neutral",
    },
    {
      label: "Accounts Worked On",
      value: String(workedThisQuarter),
      // The all-time figure sits beside it: one number says how busy the
      // quarter was, the other how wide the person's experience is, and
      // neither answers the other's question.
      sub: `${workedAllTime} all time`,
      tag: "Accounts",
      tone: "neutral",
    },
  ]

  return {
    scope: query.employeeId ? "employee" : "me",
    employeeId: employee.id,
    employeeName: employee.fullName,
    calendarYear,
    quarter,
    stats,
    quarters,
    actions,
    // Counted once, here, and keyed by the row's own href. Two sources drift,
    // and the one that drifts is always the one nobody is looking at.
    badges: Object.fromEntries(actions.map((row) => [row.href, row.count])),
    notBuilt: ["meetings", "tasks"],
  }
}
