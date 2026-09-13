/**
 * The Sales Hub landing page, in two bands.
 *
 * **Band 1 is my quarter** — target, achievement, and the money beside the
 * count. **Band 2 is what needs doing**, and it is the half that makes this
 * page operational rather than decorative. An admin asking for the whole team
 * gets the same two bands, with every roll-up row naming the person it is
 * about.
 *
 * Presentation-ready, as every dashboard in this codebase is: the tone comes
 * from `dashboard.tone.ts`, so a threshold lives in one file rather than in
 * five components that agreed once. The client renders what it is given and
 * decides nothing.
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
import { officeDateOf } from "../attendance/attendance.time"
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

/** The documented spelling for the team roll-up: `?employeeId=all`. */
export const ALL_EMPLOYEES = "all"

export interface SalesDashboardQuery {
  /** A uuid, or the literal "all" for the team roll-up. */
  employeeId?: string
  /** Injected so a test can pin the quarter. Production passes nothing. */
  now?: Date
}

/** Who a set of figures is about: one person, or the whole hub. */
type Subject = { employeeIds: string[] | null; userIds: string[] | null }

function isSalesAdmin(actor: AccessTokenPayload): boolean {
  return actor.role === Role.SUPER_ADMIN || actor.salesRole === SalesRole.SALES_ADMIN
}

/** `null` means every account, used by the team roll-up. */
function ownerFilter(employeeIds: string[] | null) {
  return employeeIds ? { ownerEmployeeId: { in: employeeIds } } : {}
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
 * Distinct accounts somebody actually did something on, in a window.
 *
 * *Worked on* is an action, so it is counted from actions (C4). Two sources,
 * and the choice of both is deliberate:
 *
 * - **Communications** carry a frozen `employeeId` — authorship survives the
 *   account changing hands — and an `occurredAt` that records when the call
 *   happened rather than when it was typed.
 * - **Opportunity changes** are read from the **audit log**, not from the
 *   opportunity row. `ownerEmployeeId` is the *current* owner, so counting on
 *   it would hand a new owner credit for work they did not do and take it from
 *   the person who did. And `lastActivityAt` holds only the most recent touch,
 *   so a deal worked in Q1 and again in Q3 would vanish from Q1 entirely — a
 *   later edit silently rewriting an earlier quarter. An audit row is written
 *   once, attributed to the actor, and never moves.
 *
 * Meetings are the third source C4 names. They arrive in phase 3.
 */
async function accountsWorkedOn(
  subject: Subject,
  window?: { gte: Date; lt: Date }
): Promise<number> {
  const [communications, audits] = await Promise.all([
    prisma.salesCommunication.findMany({
      where: {
        ...(subject.employeeIds ? { employeeId: { in: subject.employeeIds } } : {}),
        ...(window ? { occurredAt: window } : {}),
      },
      select: { salesAccountId: true },
    }),
    prisma.auditLog.findMany({
      where: {
        entity: "OPPORTUNITY",
        ...(subject.userIds
          ? subject.userIds.length === 1
            ? { changedBy: subject.userIds[0] }
            : { changedBy: { in: subject.userIds } }
          : {}),
        ...(window ? { changedAt: window } : {}),
      },
      select: { entityId: true },
    }),
  ])

  const ids = new Set<string>()
  for (const row of communications) ids.add(row.salesAccountId)

  // The audit row knows which opportunity moved, not which account it hangs
  // off. One extra query rather than one per row.
  const touched = [...new Set(audits.map((row) => row.entityId))]
  if (touched.length > 0) {
    const opportunities = await prisma.opportunity.findMany({
      where: { id: { in: touched } },
      select: { salesAccountId: true },
    })
    for (const row of opportunities) ids.add(row.salesAccountId)
  }
  return ids.size
}

/** Figures for one quarter, for one person or for everybody. */
async function figuresFor(subject: Subject, calendarYear: number, quarter: number) {
  const { start, end } = quarterRange(calendarYear, quarter)
  const window = { gte: start, lt: end }
  const owned = ownerFilter(subject.employeeIds)
  const winner = subject.employeeIds ? { wonByEmployeeId: { in: subject.employeeIds } } : {}

  const [wins, ongoing, lost, cancelled, total] = await Promise.all([
    prisma.opportunity.findMany({
      // `status: WON` as well as the winner, because the winner id is never
      // cleared on a reopen — a deal won, reopened and then lost still carries
      // it, and would otherwise still be counted as a win.
      where: { ...winner, status: "WON", closedAt: window },
      select: { amount: true },
    }),
    prisma.opportunity.findMany({ where: { ...owned, status: "ONGOING" }, select: { amount: true } }),
    prisma.opportunity.count({ where: { ...owned, status: "LOST", closedAt: window } }),
    prisma.opportunity.count({ where: { ...owned, status: "CANCELLED", closedAt: window } }),
    prisma.opportunity.count({ where: owned }),
  ])

  return { won: money(wins), ongoing: money(ongoing), lost, cancelled, total }
}

/** Band 2. Only rows with a table behind them; see the module comment. */
async function actionRows(subject: Subject, now: Date): Promise<SalesActionRow[]> {
  // Office-local start of today, not the current instant. `expectedCloseDate`
  // is date-only at UTC midnight, so a window opening at "now" drops
  // everything due today the moment midnight passes.
  const today = officeDateOf(now)
  const closingBy = new Date(today.getTime() + CLOSING_DAYS * MS_PER_DAY)
  const quietBefore = new Date(now.getTime() - QUIET_DAYS * MS_PER_DAY)
  const stuckBefore = new Date(now.getTime() - STUCK_DAYS * MS_PER_DAY)
  const owned = ownerFilter(subject.employeeIds)
  const open = { ...owned, status: "ONGOING" as const }

  const [closing, unverified, quiet, stuck] = await Promise.all([
    prisma.opportunity.count({
      where: { ...open, expectedCloseDate: { gte: today, lte: closingBy } },
    }),
    prisma.salesAccount.count({ where: { ...owned, contacts: { none: { status: "VERIFIED" } } } }),
    prisma.opportunity.count({ where: { ...open, lastActivityAt: { lt: quietBefore } } }),
    prisma.opportunity.count({ where: { ...open, stageChangedAt: { lt: stuckBefore } } }),
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

/** Band 1, built once and used by both the personal view and the roll-up. */
function bandOne(
  figures: Awaited<ReturnType<typeof figuresFor>>,
  target: number | null,
  quarter: number,
  calendarYear: number,
  worked: { period: number; allTime: number },
  labels: { target: string; achievement: string; ongoing: string }
): DashboardStat[] {
  return [
    {
      label: labels.target,
      // "Not set" and never 0: nobody deciding is a different fact from
      // somebody deciding zero.
      value: target === null ? "Not set" : String(target),
      sub: `Q${quarter} ${calendarYear}`,
      tag: "Target",
      tone: toneFor.informational(),
    },
    {
      label: labels.achievement,
      value: String(figures.won.count),
      sub: figures.won.unpriced > 0 ? `${figures.won.unpriced} with no price yet` : "Deals won and closed",
      tag: "Won",
      tone: toneFor.informational(),
    },
    // Rendered only when a target exists. "0 of 0" is a sentence about a
    // decision nobody made.
    ...(target === null
      ? []
      : [
          {
            label: "Against Target",
            value: `${figures.won.count} of ${target}`,
            sub: `Q${quarter}`,
            tag: "Progress",
            tone: toneFor.rate(target === 0 ? 100 : (figures.won.count / target) * 100, {
              good: 100,
              bad: 50,
            }),
          } satisfies DashboardStat,
        ]),
    {
      label: "Value Won",
      value: bdt(dec(figures.won.value)),
      sub:
        figures.won.unpriced > 0
          ? `${figures.won.unpriced} won deal${figures.won.unpriced === 1 ? "" : "s"} with no price yet`
          : "This quarter",
      tag: "Value",
      tone: toneFor.informational(),
    },
    {
      label: labels.ongoing,
      value: String(figures.ongoing.count),
      sub:
        figures.ongoing.unpriced > 0
          ? `${bdt(dec(figures.ongoing.value))}, ${figures.ongoing.unpriced} with no price yet`
          : bdt(dec(figures.ongoing.value)),
      tag: "Open",
      tone: toneFor.informational(),
    },
    {
      label: "Lost",
      value: String(figures.lost),
      sub: `Q${quarter}`,
      tag: "Lost",
      tone: toneFor.informational(),
    },
    {
      label: "Cancelled",
      value: String(figures.cancelled),
      sub: `Q${quarter}`,
      tag: "Cancelled",
      tone: toneFor.informational(),
    },
    {
      label: "Total Opportunities",
      value: String(figures.total),
      sub: "All time",
      tag: "Total",
      tone: toneFor.informational(),
    },
    {
      label: "Accounts Worked On",
      value: String(worked.period),
      // The all-time figure sits beside it: one number says how busy the
      // quarter was, the other how wide the experience is, and neither answers
      // the other's question.
      sub: `${worked.allTime} all time`,
      tag: "Accounts",
      tone: toneFor.informational(),
    },
  ]
}

/** The four quarters of one year, for one person or for everybody. */
async function quarterTable(
  subject: Subject,
  calendarYear: number,
  targetBy: Map<number, number>
): Promise<SalesQuarterRow[]> {
  return Promise.all(
    [1, 2, 3, 4].map(async (quarter) => {
      const figures = await figuresFor(subject, calendarYear, quarter)
      return {
        quarter,
        target: targetBy.get(quarter) ?? null,
        achievement: figures.won.count,
        valueWon: figures.won.value,
      }
    })
  )
}

export async function getSalesDashboard(
  query: SalesDashboardQuery,
  actor: AccessTokenPayload
): Promise<SalesDashboardPayload> {
  const now = query.now ?? new Date()
  const { calendarYear, quarter } = currentQuarter(now)
  const ownEmployeeId = await employeeIdFor(actor)
  const wantsTeam = query.employeeId === ALL_EMPLOYEES

  if (wantsTeam && !isSalesAdmin(actor)) {
    throw new AppError(403, "Only a Sales Admin can see the whole team")
  }
  if (query.employeeId && !wantsTeam && query.employeeId !== ownEmployeeId && !isSalesAdmin(actor)) {
    throw new AppError(403, "You can only see your own dashboard")
  }

  // ── the whole team ───────────────────────────────────────────────────────
  if (wantsTeam) {
    const people = await prisma.employee.findMany({
      where: { user: { salesRole: { not: null } } },
      select: { id: true, fullName: true, userId: true },
      orderBy: { fullName: "asc" },
    })
    const subject: Subject = {
      employeeIds: people.map((person) => person.id),
      userIds: people.map((person) => person.userId),
    }

    const targets = await prisma.salesTarget.findMany({
      where: { calendarYear },
      select: { employeeId: true, quarter: true, targetDeals: true },
    })
    // Summed per quarter across everybody who has one. A quarter nobody has a
    // target in stays null rather than becoming a team target of zero.
    const teamTargetBy = new Map<number, number>()
    for (const row of targets) {
      teamTargetBy.set(row.quarter, (teamTargetBy.get(row.quarter) ?? 0) + row.targetDeals)
    }
    const thisQuarterTargets = new Map(
      targets.filter((row) => row.quarter === quarter).map((row) => [row.employeeId, row.targetDeals])
    )

    const window = quarterRange(calendarYear, quarter)
    const [figures, actions, quarters, workedPeriod, workedAllTime, team] = await Promise.all([
      figuresFor(subject, calendarYear, quarter),
      actionRows(subject, now),
      quarterTable(subject, calendarYear, teamTargetBy),
      accountsWorkedOn(subject, { gte: window.start, lt: window.end }),
      accountsWorkedOn(subject),
      Promise.all(
        people.map(async (person) => {
          const personFigures = await figuresFor(
            { employeeIds: [person.id], userIds: [person.userId] },
            calendarYear,
            quarter
          )
          return {
            employeeId: person.id,
            employeeName: person.fullName,
            target: thisQuarterTargets.get(person.id) ?? null,
            achievement: personFigures.won.count,
            valueWon: personFigures.won.value,
            ongoing: personFigures.ongoing.count,
          } satisfies SalesTeamRow
        })
      ),
    ])

    return {
      scope: "all",
      employeeId: null,
      employeeName: "Everyone",
      calendarYear,
      quarter,
      stats: bandOne(
        figures,
        teamTargetBy.get(quarter) ?? null,
        quarter,
        calendarYear,
        { period: workedPeriod, allTime: workedAllTime },
        { target: "Team Target", achievement: "Team Achievement", ongoing: "Team Ongoing" }
      ),
      quarters,
      actions,
      team,
      badges: Object.fromEntries(actions.map((row) => [row.href, row.count])),
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
    select: { id: true, fullName: true, userId: true },
  })
  if (!employee) {
    throw new AppError(404, "That employee does not exist")
  }
  const subject: Subject = { employeeIds: [employee.id], userIds: [employee.userId] }

  const window = quarterRange(calendarYear, quarter)
  const [targets, figures, actions, workedPeriod, workedAllTime] = await Promise.all([
    prisma.salesTarget.findMany({
      where: { employeeId: subjectId, calendarYear },
      select: { quarter: true, targetDeals: true },
    }),
    figuresFor(subject, calendarYear, quarter),
    actionRows(subject, now),
    accountsWorkedOn(subject, { gte: window.start, lt: window.end }),
    accountsWorkedOn(subject),
  ])

  const targetBy = new Map(targets.map((row) => [row.quarter, row.targetDeals]))
  const quarters = await quarterTable(subject, calendarYear, targetBy)

  return {
    scope: query.employeeId ? "employee" : "me",
    employeeId: employee.id,
    employeeName: employee.fullName,
    calendarYear,
    quarter,
    stats: bandOne(
      figures,
      targetBy.get(quarter) ?? null,
      quarter,
      calendarYear,
      { period: workedPeriod, allTime: workedAllTime },
      { target: "Quarterly Target", achievement: "Quarterly Achievement", ongoing: "Ongoing" }
    ),
    quarters,
    actions,
    // Counted once, here, and keyed by the row's own href. Two sources drift,
    // and the one that drifts is always the one nobody is looking at.
    badges: Object.fromEntries(actions.map((row) => [row.href, row.count])),
    notBuilt: ["meetings", "tasks"],
  }
}
