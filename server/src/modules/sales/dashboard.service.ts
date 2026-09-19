/**
 * The Sales Hub landing page, in two bands.
 *
 * **Band 1 is my quarter and my year** — the target in taka, what was won
 * against it, and the margin on what was won. **Band 2 is what needs doing**,
 * and it is the half that makes this page operational rather than
 * decorative. An admin asking for the whole team gets the same two bands,
 * with every roll-up row naming the person it is about.
 *
 * Targets come from `target.plan.ts`: one yearly amount split over the
 * quarters, each ended quarter's shortfall carried into the next. The team's
 * figures are each person's plan added up — carrying is per person, so one
 * person's extra never covers another's shortfall.
 *
 * Presentation-ready, as every dashboard in this codebase is: the tone comes
 * from `dashboard.tone.ts`, so a threshold lives in one file rather than in
 * five components that agreed once. The client renders what it is given and
 * decides nothing.
 *
 * Band 2 has seven rows: phase 3 brought meetings and tasks (revision §24.22)
 * and phase 4 meetings with no minutes (§25.29), so `notBuilt` is empty. It
 * stays in the payload for the next thing that is not built: an absent row
 * must be named, never shown as zero.
 */

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { Role, SalesRole } from "../../generated/prisma/client"
import type { AccessTokenPayload } from "../auth/auth.types"
import { addDays } from "../../utils/dates"
import { officeDateOf, officeInstantOf } from "../attendance/attendance.time"
import { bdt } from "../dashboard/dashboard.format"
import { toneFor } from "../dashboard/dashboard.tone"
import type { DashboardStat } from "../dashboard/dashboard.types"
import { dec, sum, toMoneyString, type Money } from "../payroll/payroll.money"
import { employeeIdFor } from "./sales.access"
import { marginTotal, type MarginTotal } from "./sales.margin"
import { WAITING_DAYS, waitingForMinutesWhere } from "./minutes.waiting"
import { weekStartOf } from "./weekly.dates"
import { currentQuarter, quarterOf, quarterRange } from "./sales.quarters"
import { planQuarters, sumPlans, type PlannedQuarter } from "./target.plan"
import { phasesOf, presentQuarter, winsByQuarter, yearRange } from "./target.service"
import type { SalesActionRow, SalesDashboardPayload, SalesTeamRow } from "./sales.types"

const MS_PER_DAY = 86_400_000

/** Deals quiet for this long need chasing. */
const QUIET_DAYS = 30
/** A deal that has not moved stage in this long is stuck — the reason Stage exists. */
const STUCK_DAYS = 21
/** How far ahead the closing-soon row looks. */
const CLOSING_DAYS = 30
/** "This week" for meetings: today and the six days after it. */
const WEEK_DAYS = 7

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

/** A won deal, as much of it as this page needs. */
type Win = {
  wonByEmployeeId: string | null
  amount: Money | null
  closedAt: Date | null
  /** The margin lives on the products, so they come with the deal. */
  lines: { lineValue: Money | null; marginPercent: Money | null }[]
}

function isSalesAdmin(actor: AccessTokenPayload): boolean {
  return actor.role === Role.SUPER_ADMIN || actor.salesRole === SalesRole.SALES_ADMIN
}

/** `null` means every account, used by the team roll-up. */
function ownerFilter(employeeIds: string[] | null) {
  return employeeIds ? { ownerEmployeeId: { in: employeeIds } } : {}
}

/** Meetings these people attend on our side. `null` means everybody's. */
function attendingFor(subject: Subject) {
  return subject.employeeIds
    ? { attendees: { some: { side: "OURS" as const, employeeId: { in: subject.employeeIds } } } }
    : {}
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

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`
const sumCounts = (values: number[]) => values.reduce((a, b) => a + b, 0)
const withUnpriced = (text: string, unpriced: number) =>
  unpriced > 0 ? `${text}, ${unpriced} with no price yet` : text
/** `part` as a percentage of `whole`. Callers only ask when `whole` is above zero. */
const percentOf = (part: Money, whole: Money) => Number(part.dividedBy(whole).times(100))
const moneyOrNull = (value: Money | null) => (value === null ? null : toMoneyString(value))

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
 * - **Completed meetings** are the third source C4 names: a meeting that
 *   happened, attended on our side, counted in the window it was held.
 */
async function accountsWorkedOn(
  subject: Subject,
  window?: { gte: Date; lt: Date }
): Promise<number> {
  const [communications, audits, meetings] = await Promise.all([
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
    prisma.salesMeeting.findMany({
      where: {
        status: "COMPLETED",
        ...attendingFor(subject),
        ...(window ? { scheduledAt: window } : {}),
      },
      select: { salesAccountId: true },
    }),
  ])

  const ids = new Set<string>()
  for (const row of communications) ids.add(row.salesAccountId)
  for (const row of meetings) ids.add(row.salesAccountId)

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

/** Everything in Band 1 that is not a win: open, lost and cancelled deals, and the all-time count. */
async function pipelineFor(subject: Subject, calendarYear: number, quarter: number) {
  const { start, end } = quarterRange(calendarYear, quarter)
  const window = { gte: start, lt: end }
  const owned = ownerFilter(subject.employeeIds)

  const [ongoing, lost, cancelled, total] = await Promise.all([
    prisma.opportunity.findMany({ where: { ...owned, status: "ONGOING" }, select: { amount: true } }),
    prisma.opportunity.count({ where: { ...owned, status: "LOST", closedAt: window } }),
    prisma.opportunity.count({ where: { ...owned, status: "CANCELLED", closedAt: window } }),
    prisma.opportunity.count({ where: owned }),
  ])

  return { ongoing: money(ongoing), lost, cancelled, total }
}

/**
 * Deals these people won in the year. Two filters do the work, and both are
 * load-bearing: `wonByEmployeeId`, because credit belongs to whoever ran the
 * deal on the day it was won and does not follow the account (C3); and
 * `status: WON`, because the winner id survives a reopen, so a deal won,
 * reopened and then lost still carries it.
 */
function winsInYear(employeeIds: string[], calendarYear: number): Promise<Win[]> {
  return prisma.opportunity.findMany({
    where: {
      wonByEmployeeId: employeeIds.length === 1 ? employeeIds[0] : { in: employeeIds },
      status: "WON",
      closedAt: yearRange(calendarYear),
    },
    select: {
      wonByEmployeeId: true,
      amount: true,
      closedAt: true,
      lines: { select: { lineValue: true, marginPercent: true } },
    },
  })
}

/** Band 2. Only rows with a table behind them; see the module comment. */
async function actionRows(
  subject: Subject,
  now: Date,
  /** Whose own week to report on: a Sales User reading their overview, or null for the roll-up. */
  writerEmployeeId: string | null
): Promise<SalesActionRow[]> {
  // Office-local start of today, not the current instant. `expectedCloseDate`
  // is date-only at UTC midnight, so a window opening at "now" drops
  // everything due today the moment midnight passes.
  const today = officeDateOf(now)
  const closingBy = new Date(today.getTime() + CLOSING_DAYS * MS_PER_DAY)
  const quietBefore = new Date(now.getTime() - QUIET_DAYS * MS_PER_DAY)
  const stuckBefore = new Date(now.getTime() - STUCK_DAYS * MS_PER_DAY)
  const owned = ownerFilter(subject.employeeIds)
  const open = { ...owned, status: "ONGOING" as const }

  // Meetings run on instants, so "today" is the office day's own start and end.
  const dayStart = officeInstantOf(today, "00:00")
  const meetingsBefore = (end: Date) =>
    prisma.salesMeeting.count({
      where: { status: "SCHEDULED", ...attendingFor(subject), scheduledAt: { gte: dayStart, lt: end } },
    })
  const assigned = subject.employeeIds ? { assignedToEmployeeId: { in: subject.employeeIds } } : {}

  // A writer reads their own week; everybody else reads the roll-up (§26.16).
  // Sales Admins do not write weekly reports, so they never see the writer row.
  const mine = writerEmployeeId
  const weekStart = weekStartOf(today)
  const lastWeekStart = addDays(weekStart, -7)

  const [closing, unverified, quiet, stuck, meetingsToday, meetingsWeek, tasksDue, tasksOverdue, minutesWaiting, myWeek, weeklyWriters, weeklySubmitted, myFunnelOpen, funnelReviewed] = await Promise.all([
    prisma.opportunity.count({
      where: { ...open, expectedCloseDate: { gte: today, lte: closingBy } },
    }),
    prisma.salesAccount.count({ where: { ...owned, contacts: { none: { status: "VERIFIED" } } } }),
    prisma.opportunity.count({ where: { ...open, lastActivityAt: { lt: quietBefore } } }),
    prisma.opportunity.count({ where: { ...open, stageChangedAt: { lt: stuckBefore } } }),
    meetingsBefore(officeInstantOf(addDays(today, 1), "00:00")),
    meetingsBefore(officeInstantOf(addDays(today, WEEK_DAYS), "00:00")),
    prisma.salesTask.count({ where: { status: "PENDING", ...assigned, dueOn: { lte: today } } }),
    prisma.salesTask.count({ where: { status: "PENDING", ...assigned, dueOn: { lt: today } } }),
    // The Meeting Minutes page's own rule, so this row, its badge and that
    // page's "Waiting for minutes" can never disagree.
    prisma.salesMeeting.count({ where: waitingForMinutesWhere(subject.employeeIds, now) }),
    // The weekly report (§26.16). A writer is told where their own week
    // stands; the roll-up counts the reports last week is still missing.
    mine
      ? prisma.weeklyReport.findUnique({
          where: { employeeId_weekStart: { employeeId: mine, weekStart } },
          select: { status: true },
        })
      : Promise.resolve(null),
    mine
      ? Promise.resolve(0)
      : prisma.employee.count({
          where: { user: { salesRole: SalesRole.SALES_USER, isActive: true }, employmentStatus: "ACTIVE" },
        }),
    mine
      ? Promise.resolve(0)
      : prisma.weeklyReport.count({ where: { weekStart: lastWeekStart, status: "SUBMITTED" } }),
    // The funnel (§27.14). A writer is told how many of their own quoted
    // deals are still live; an admin is told how many people have not been
    // walked yet in the week under review.
    mine
      ? prisma.opportunity.count({
          where: {
            ownerEmployeeId: mine,
            offeredOn: { not: null },
            status: { notIn: ["LOST", "CANCELLED"] },
          },
        })
      : Promise.resolve(0),
    mine
      ? Promise.resolve(0)
      : prisma.funnelMeetingReview.count({ where: { funnelMeeting: { weekStart: lastWeekStart } } }),
  ])

  return [
    {
      key: "meetings",
      label: "Meetings today and this week",
      count: meetingsWeek,
      detail:
        meetingsWeek === 0
          ? "Nothing in the next 7 days"
          : meetingsToday === 0
            ? "None today"
            : `${meetingsToday} today`,
      // Work booked, not work behind: a full diary is not a warning.
      tone: toneFor.informational(),
      href: "/meetings",
    },
    {
      key: "tasks",
      label: "Tasks due or overdue",
      count: tasksDue,
      detail:
        tasksDue === 0 ? "Nothing due today" : tasksOverdue > 0 ? `${tasksOverdue} overdue` : "All due today",
      tone: toneFor.queue(tasksDue),
      href: "/tasks?due=now",
    },
    {
      key: "minutes",
      label: "Meetings with no minutes",
      count: minutesWaiting,
      detail:
        minutesWaiting === 0
          ? `Every meeting from the last ${WAITING_DAYS} days has minutes`
          : `Completed in the last ${WAITING_DAYS} days`,
      tone: toneFor.queue(minutesWaiting),
      href: "/meetings/minutes",
    },
    // A writer sees a status line and no badge: their own week is not a
    // queue of work. The roll-up counts what is still missing.
    mine
      ? {
          key: "weekly",
          label: "This week's report",
          // One report outstanding, or none. A bare 0 beside a status line
          // reads as nothing at all; the menu badge is still admin-only.
          count: myWeek?.status === "SUBMITTED" ? 0 : 1,
          detail:
            myWeek?.status === "SUBMITTED" ? "Submitted" : myWeek?.status === "DRAFT" ? "Draft" : "Not started",
          tone: toneFor.queue(myWeek?.status === "SUBMITTED" ? 0 : 1),
          href: "/weekly",
        }
      : {
          key: "weekly",
          label: "Last week's reports not submitted",
          count: Math.max(weeklyWriters - weeklySubmitted, 0),
          detail:
            weeklyWriters - weeklySubmitted <= 0
              ? "Everybody sent last week's report"
              : `Of ${weeklyWriters} Sales Users`,
          tone: toneFor.queue(Math.max(weeklyWriters - weeklySubmitted, 0)),
          href: "/weekly/all",
        },
    // The funnel row (§27.14), following Weekly Report in the menu and here.
    mine
      ? {
          key: "funnel",
          label: "Deals in your funnel",
          count: myFunnelOpen,
          // Informational, not a queue: a full funnel is the good outcome.
          // Colouring it as work would make the number read as a warning.
          detail: myFunnelOpen === 0 ? "Nothing quoted and still open" : "Quoted and still open",
          tone: toneFor.informational(),
          href: "/funnel",
        }
      : {
          key: "funnel",
          label: "Funnels not reviewed last week",
          count: Math.max(weeklyWriters - funnelReviewed, 0),
          detail:
            weeklyWriters - funnelReviewed <= 0
              ? "Everybody was walked"
              : `Of ${weeklyWriters} Sales Users`,
          tone: toneFor.queue(Math.max(weeklyWriters - funnelReviewed, 0)),
          href: "/funnel",
        },
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

/** The year Band 1 describes: this quarter from the plan, the whole year, and the margin on both. */
interface YearFigures {
  calendarYear: number
  quarter: number
  current: PlannedQuarter
  currentDeals: number
  currentUnpriced: number
  yearlyTarget: Money | null
  /** Null for the team, which has no single start quarter. */
  startQuarter: number | null
  yearWon: Money
  yearDeals: number
  yearUnpriced: number
  marginQuarter: MarginTotal
  marginYear: MarginTotal
}

function yearFigures(
  plan: PlannedQuarter[],
  bucket: ReturnType<typeof winsByQuarter>,
  wins: Win[],
  calendarYear: number,
  quarter: number,
  yearlyTarget: Money | null,
  startQuarter: number | null
): YearFigures {
  const index = quarter - 1
  return {
    calendarYear,
    quarter,
    current: plan[index],
    currentDeals: bucket.deals[index],
    currentUnpriced: bucket.unpriced[index],
    yearlyTarget,
    startQuarter,
    yearWon: sum(bucket.value),
    yearDeals: sumCounts(bucket.deals),
    yearUnpriced: sumCounts(bucket.unpriced),
    marginQuarter: marginTotal(wins.filter((win) => win.closedAt && quarterOf(win.closedAt) === quarter)),
    marginYear: marginTotal(wins),
  }
}

/** Rendered only when a target exists. "0% of nothing" is a sentence about a decision nobody made. */
function againstTarget(current: PlannedQuarter, quarter: number): DashboardStat[] {
  if (current.target === null || current.gap === null || !current.target.greaterThan(0)) return []
  const rate = percentOf(current.won, current.target)
  return [
    {
      label: "Against Target",
      value: `${Math.round(rate)}%`,
      sub: current.gap.greaterThan(0)
        ? `Q${quarter}: short by ${bdt(current.gap)}`
        : current.gap.lessThan(0)
          ? `Q${quarter}: ahead by ${bdt(current.gap.abs())}`
          : `Q${quarter}: on target`,
      tag: "Progress",
      tone: toneFor.rate(rate, { good: 100, bad: 50 }),
      icon: "progress",
    },
  ]
}

function marginStat(label: string, total: MarginTotal, period: string): DashboardStat {
  // What could not be counted, named rather than folded in as zero.
  const gaps = [
    total.missing > 0 ? `${plural(total.missing, "product")} with no margin yet` : null,
    total.dealsWithoutProducts > 0 ? `${plural(total.dealsWithoutProducts, "won deal")} with no products` : null,
  ]
    .filter(Boolean)
    .join(", ")
  // "No margin yet" only when there were wins and none of them carries a
  // margin. A period with no wins at all made ৳0, which is a fact, not a gap.
  const unknown = total.counted === 0 && gaps !== ""
  return {
    label,
    value: unknown ? "No margin yet" : bdt(dec(total.value)),
    sub: gaps
      ? gaps
      : total.counted === 0
        ? `No deals won in ${period}`
        : `From ${plural(total.counted, "product")} on won deals in ${period}`,
    tag: "Margin",
    tone: toneFor.informational(),
    icon: "margin",
  }
}

interface BandOneLabels {
  target: string
  achievement: string
  dealsWon: string
  yearlyTarget: string
  yearlyAchievement: string
  marginWon: string
  yearlyMargin: string
  ongoing: string
}

/** Band 1, built once and used by both the personal view and the roll-up. */
function bandOne(
  year: YearFigures,
  pipeline: Awaited<ReturnType<typeof pipelineFor>>,
  worked: { period: number; allTime: number },
  labels: BandOneLabels
): DashboardStat[] {
  const { current, quarter, calendarYear } = year
  const carried = current.carried !== null && current.carried.greaterThan(0) ? current.carried : null
  const startsLater =
    current.target === null && year.yearlyTarget !== null && year.startQuarter !== null && year.startQuarter > quarter

  // Three labelled rows, in the order the page draws them (§23 of the
  // revision). The grouping is decided here; the page only draws consecutive
  // stats that share a group together.
  const inGroup = (group: string, stats: DashboardStat[]): DashboardStat[] =>
    stats.map((stat) => ({ ...stat, group }))

  return [
    ...inGroup("This quarter", [
      {
        label: labels.target,
        // "Not set" and never ৳0: nobody deciding is a different fact from
        // somebody deciding zero.
        value: current.target === null ? "Not set" : bdt(current.target),
        sub: startsLater
          ? `The yearly target starts in Q${year.startQuarter}`
          : carried
            ? `Q${quarter} ${calendarYear} · ${bdt(carried)} carried from Q${quarter - 1}`
            : `Q${quarter} ${calendarYear}`,
        tag: "Target",
        tone: toneFor.informational(),
        icon: "target",
      },
      {
        label: labels.achievement,
        value: bdt(current.won),
        sub: withUnpriced("Value of the deals won", year.currentUnpriced),
        tag: "Won",
        tone: toneFor.informational(),
        icon: "won",
      },
      // The count, beside the money. Achievement became a taka figure when
      // targets did, and this keeps the number of deals on the page as a tile.
      {
        label: labels.dealsWon,
        value: String(year.currentDeals),
        sub: `Q${quarter} ${calendarYear}`,
        tag: "Won",
        tone: toneFor.informational(),
        icon: "deals",
      },
      ...againstTarget(current, quarter),
      marginStat(labels.marginWon, year.marginQuarter, `Q${quarter}`),
    ]),
    ...inGroup("This year", [
      {
        label: labels.yearlyTarget,
        value: year.yearlyTarget === null ? "Not set" : bdt(year.yearlyTarget),
        sub:
          year.startQuarter !== null && year.startQuarter > 1
            ? `${calendarYear}, from Q${year.startQuarter}`
            : String(calendarYear),
        tag: "Target",
        tone: toneFor.informational(),
        icon: "target",
      },
      {
        label: labels.yearlyAchievement,
        value: bdt(year.yearWon),
        sub: withUnpriced(
          year.yearlyTarget !== null && year.yearlyTarget.greaterThan(0)
            ? `${Math.round(percentOf(year.yearWon, year.yearlyTarget))}% of the yearly target`
            : `${plural(year.yearDeals, "deal")} won in ${calendarYear}`,
          year.yearUnpriced
        ),
        tag: "Won",
        tone: toneFor.informational(),
        icon: "won",
      },
      marginStat(labels.yearlyMargin, year.marginYear, String(calendarYear)),
    ]),
    ...inGroup("Pipeline", [
      {
        label: labels.ongoing,
        value: String(pipeline.ongoing.count),
        sub:
          pipeline.ongoing.unpriced > 0
            ? `${bdt(dec(pipeline.ongoing.value))}, ${pipeline.ongoing.unpriced} with no price yet`
            : bdt(dec(pipeline.ongoing.value)),
        tag: "Open",
        tone: toneFor.informational(),
        icon: "open",
      },
      {
        label: "Lost",
        value: String(pipeline.lost),
        sub: `Q${quarter}`,
        tag: "Lost",
        tone: toneFor.informational(),
        icon: "lost",
      },
      {
        label: "Cancelled",
        value: String(pipeline.cancelled),
        sub: `Q${quarter}`,
        tag: "Cancelled",
        tone: toneFor.informational(),
        icon: "cancelled",
      },
      {
        label: "Total Opportunities",
        value: String(pipeline.total),
        sub: "All time",
        tag: "Total",
        tone: toneFor.informational(),
        icon: "total",
      },
      {
        label: "Accounts Worked On",
        value: String(worked.period),
        // The all-time figure sits beside it: one number says how busy the
        // quarter was, the other how wide the experience is, and neither
        // answers the other's question.
        sub: `${worked.allTime} all time`,
        tag: "Accounts",
        tone: toneFor.informational(),
        icon: "accounts",
      },
    ]),
  ]
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

  const phases = phasesOf(calendarYear, now)
  const window = quarterRange(calendarYear, quarter)

  // ── the whole team ───────────────────────────────────────────────────────
  if (wantsTeam) {
    const people = await prisma.employee.findMany({
      where: { user: { salesRole: { not: null } } },
      select: { id: true, fullName: true, userId: true },
      orderBy: { fullName: "asc" },
    })
    const ids = people.map((person) => person.id)
    const subject: Subject = { employeeIds: ids, userIds: people.map((person) => person.userId) }

    const [targets, wins, pipeline, actions, workedPeriod, workedAllTime, ongoingByPerson] = await Promise.all([
      prisma.salesTarget.findMany({
        where: { calendarYear },
        select: { employeeId: true, amount: true, startQuarter: true },
      }),
      winsInYear(ids, calendarYear),
      pipelineFor(subject, calendarYear, quarter),
      actionRows(subject, now, null),
      accountsWorkedOn(subject, { gte: window.start, lt: window.end }),
      accountsWorkedOn(subject),
      Promise.all(
        people.map((person) =>
          prisma.opportunity.count({ where: { ownerEmployeeId: person.id, status: "ONGOING" } })
        )
      ),
    ])

    // Each person planned on their own wins first, then added up.
    const targetBy = new Map(targets.map((row) => [row.employeeId, row]))
    const perPerson = people.map((person) => {
      const target = targetBy.get(person.id) ?? null
      const bucket = winsByQuarter(wins.filter((win) => win.wonByEmployeeId === person.id))
      const plan = planQuarters({
        yearly: target ? dec(target.amount) : null,
        startQuarter: target?.startQuarter ?? 1,
        won: bucket.value,
        phases,
      })
      return { person, target, bucket, plan }
    })

    const teamPlan = sumPlans(perPerson.map((row) => row.plan), phases)
    const teamBucket = winsByQuarter(wins)
    const teamTargets = perPerson.flatMap((row) => (row.target ? [dec(row.target.amount)] : []))
    const year = yearFigures(
      teamPlan,
      teamBucket,
      wins,
      calendarYear,
      quarter,
      // A year nobody has a target in stays "not set", not a team target of zero.
      teamTargets.length > 0 ? sum(teamTargets) : null,
      null
    )

    const team: SalesTeamRow[] = perPerson.map((row, index) => ({
      employeeId: row.person.id,
      employeeName: row.person.fullName,
      target: moneyOrNull(row.plan[quarter - 1].target),
      valueWon: toMoneyString(row.plan[quarter - 1].won),
      dealsWon: row.bucket.deals[quarter - 1],
      ongoing: ongoingByPerson[index],
    }))

    return {
      scope: "all",
      employeeId: null,
      employeeName: "Everyone",
      calendarYear,
      quarter,
      stats: bandOne(year, pipeline, { period: workedPeriod, allTime: workedAllTime }, {
        target: "Team Target",
        achievement: "Team Achievement",
        dealsWon: "Team Deals Won",
        yearlyTarget: "Team Yearly Target",
        yearlyAchievement: "Team Yearly Achievement",
        marginWon: "Team Margin Won",
        yearlyMargin: "Team Yearly Margin",
        ongoing: "Team Ongoing",
      }),
      quarters: teamPlan.map((planned, index) =>
        presentQuarter(planned, teamBucket.deals[index], teamBucket.unpriced[index])
      ),
      actions,
      team,
      badges: Object.fromEntries(actions.map((row) => [row.href, row.count])),
      notBuilt: [],
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

  const [targets, wins, pipeline, actions, workedPeriod, workedAllTime] = await Promise.all([
    prisma.salesTarget.findMany({
      where: { employeeId: employee.id, calendarYear },
      select: { amount: true, startQuarter: true },
    }),
    winsInYear([employee.id], calendarYear),
    pipelineFor(subject, calendarYear, quarter),
    actionRows(subject, now, actor.salesRole === SalesRole.SALES_USER ? employee.id : null),
    accountsWorkedOn(subject, { gte: window.start, lt: window.end }),
    accountsWorkedOn(subject),
  ])

  const target = targets[0] ?? null
  const yearly = target ? dec(target.amount) : null
  const bucket = winsByQuarter(wins)
  const plan = planQuarters({
    yearly,
    startQuarter: target?.startQuarter ?? 1,
    won: bucket.value,
    phases,
  })
  const year = yearFigures(plan, bucket, wins, calendarYear, quarter, yearly, target?.startQuarter ?? null)

  return {
    scope: query.employeeId ? "employee" : "me",
    employeeId: employee.id,
    employeeName: employee.fullName,
    calendarYear,
    quarter,
    stats: bandOne(year, pipeline, { period: workedPeriod, allTime: workedAllTime }, {
      target: "Quarterly Target",
      achievement: "Quarterly Achievement",
      dealsWon: "Deals Won",
      yearlyTarget: "Yearly Target",
      yearlyAchievement: "Yearly Achievement",
      marginWon: "Margin Won",
      yearlyMargin: "Yearly Margin",
      ongoing: "Ongoing",
    }),
    quarters: plan.map((planned, index) =>
      presentQuarter(planned, bucket.deals[index], bucket.unpriced[index])
    ),
    actions,
    // Counted once, here, and keyed by the row's own href. Two sources drift,
    // and the one that drifts is always the one nobody is looking at.
    badges: Object.fromEntries(actions.map((row) => [row.href, row.count])),
    notBuilt: [],
  }
}
