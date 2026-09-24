/**
 * The Super Admin landing page.
 *
 * Framed as **"what needs me, and is the org healthy"** rather than "org
 * vitals". This role's only job in the payroll workflow is approving what
 * Finance submitted, and the mock it replaces had no card saying so.
 */

import prisma from "../../config/prisma"
import { officeToday } from "../attendance/attendance.time"
import type { AccessTokenPayload } from "../auth/auth.types"
import { monthName } from "../payroll/payroll.events"
import { listWaitingForApproval } from "../dealMoney/dealMoney.approvals"
import { settleCards } from "./dashboard.cards"
import { ageInDays, days, when } from "./dashboard.format"
import { timeOfDayGreeting } from "./dashboard.greeting"
import { currentPayrollCard } from "./dashboard.payroll-card"
import { headcountSeries, payrollSeries } from "./dashboard.series"
import { toneFor } from "./dashboard.tone"
import type { DashboardPayload, DashboardStat, TableCell } from "./dashboard.types"

/**
 * What is actually waiting on this person's decision.
 *
 * A `DRAFT` settlement that was never calculated is a stub, not a queued
 * decision — counting it puts a number on the card that nobody can action.
 */
async function approvalQueue(): Promise<{ runs: number; settlements: number; total: number }> {
  const [runs, settlements] = await Promise.all([
    prisma.payrollRun.count({ where: { status: "SUBMITTED" } }),
    prisma.settlement.count({ where: { status: "DRAFT", calculatedAt: { not: null } } }),
  ])
  return { runs, settlements, total: runs + settlements }
}

async function awaitingApprovalCard(count: number): Promise<DashboardStat> {
  const { runs, settlements } = await approvalQueue()
  return {
    label: "Awaiting your approval",
    value: String(count),
    sub: `${runs} payroll run${runs === 1 ? "" : "s"} · ${settlements} settlement${settlements === 1 ? "" : "s"}`,
    tag: count === 0 ? "Clear" : "Action needed",
    tone: toneFor.blockers(count),
    href: "/admin/payroll",
  }
}

function waitingForApprovalCard(count: number): DashboardStat {
  return {
    label: "Waiting for approval",
    value: String(count),
    sub: count === 0 ? "Nothing is waiting" : `${count} draft${count === 1 ? "" : "s"} to approve or send back`,
    tag: count === 0 ? "Clear" : "Waiting",
    tone: toneFor.queue(count),
    href: "/admin/accounting/approvals",
  }
}

async function headcountCard(): Promise<DashboardStat> {
  const today = officeToday()
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))

  const [active, joinedThisMonth, departments, trend] = await Promise.all([
    prisma.employee.count({ where: { employmentStatus: "ACTIVE" } }),
    prisma.employee.count({ where: { joiningDate: { gte: monthStart } } }),
    prisma.department.count(),
    headcountSeries(6),
  ])

  return {
    label: "Total employees",
    value: String(active),
    sub: `+${joinedThisMonth} joined this month · ${departments} department${departments === 1 ? "" : "s"}`,
    tag: "Active",
    tone: "neutral",
    // Omitted rather than zeroed when there is no history to draw.
    ...(trend.length > 0 ? { trend, hotBar: trend.length - 1 } : {}),
    href: "/admin/employees",
  }
}

/**
 * The backlog that silently blocks month-end: `preflight` gates a payroll run
 * on there being no pending attendance, so this queue is a payroll problem
 * dressed as an attendance one.
 */
async function attendanceBacklogCard(count: number): Promise<DashboardStat> {
  const oldest = await prisma.attendance.findFirst({
    where: { approval: "PENDING" },
    orderBy: { date: "asc" },
    select: { date: true },
  })
  const age = oldest ? ageInDays(oldest.date, officeToday()) : 0

  return {
    label: "Attendance backlog",
    value: String(count),
    sub: count === 0 ? "Nothing pending" : `Oldest waiting ${days(age)}`,
    tag: count === 0 ? "Clear" : "Pending",
    tone: count === 0 ? "green" : toneFor.aging(age),
    href: "/admin/attendance",
  }
}

/**
 * What is actually waiting on this person, oldest first.
 *
 * Replaces a 'Recent activity' table that repeated the events log column for
 * column — same headers, same rows, one labelled 'recent' and the other 'all'.
 * Activity now lives in one place, at /admin/reports, and the dashboard
 * answers the question a landing page should: what needs me.
 *
 * The shape matches HR's 'Leave requests waiting' and Finance's 'Claims
 * waiting on you', so the three admin-facing dashboards agree on what their
 * wide panel is for.
 */
async function approvalRows(): Promise<TableCell[][]> {
  const today = officeToday()
  const [runs, settlements] = await Promise.all([
    prisma.payrollRun.findMany({
      where: { status: "SUBMITTED" },
      // When it was handed over, not when the row last changed: the question
      // is how long this has been sitting with the approver.
      orderBy: { submittedAt: "asc" },
      take: 5,
      select: { month: true, year: true, submittedAt: true, createdAt: true },
    }),
    prisma.settlement.findMany({
      where: { status: "DRAFT", calculatedAt: { not: null } },
      orderBy: { calculatedAt: "asc" },
      take: 5,
      select: { calculatedAt: true, employee: { select: { fullName: true, employeeCode: true } } },
    }),
  ])

  const rows = [
    ...runs.map((r) => ({
      what: `${monthName(r.month, r.year)} payroll`,
      sub: undefined as string | undefined,
      queue: "Payroll run",
      // Nullable in the schema even though a SUBMITTED run should always carry
      // it; falling back keeps a data oddity out of the ageing column.
      since: r.submittedAt ?? r.createdAt,
    })),
    ...settlements.map((s) => ({
      what: s.employee.fullName,
      sub: s.employee.employeeCode,
      queue: "Settlement",
      since: s.calculatedAt!,
    })),
  ].sort((a, b) => a.since.getTime() - b.since.getTime())

  return rows.slice(0, 6).map((r) => {
    const age = ageInDays(r.since, today)
    return [
      { text: r.what, sub: r.sub, weight: 500 },
      { text: r.queue },
      { text: when(r.since) },
      { tag: days(age), tone: toneFor.aging(age) },
    ]
  })
}

export async function buildAdminDashboard(actor: AccessTokenPayload): Promise<DashboardPayload> {
  // Counted once and used by both the card and the nav badge. Two sources
  // drift, and the one that drifts is always the one nobody is looking at.
  const [queue, attendanceBacklog, assetQueue, moneyWaiting] = await Promise.all([
    approvalQueue(),
    prisma.attendance.count({ where: { approval: "PENDING" } }),
    // Requests still waiting on somebody, plus handovers the holder has not
    // confirmed. Both are work; a fulfilled request and an acknowledged
    // handover are not, and must not keep the badge lit.
    Promise.all([
      prisma.assetRequest.count({ where: { status: { in: ["PENDING", "APPROVED", "ORDERED"] } } }),
      prisma.assetAssignment.count({ where: { returnedAt: null, acknowledgedAt: null } }),
    ]).then(([requests, unacknowledged]) => requests + unacknowledged),
    listWaitingForApproval(),
  ])

  const [stats, bars, waiting] = await Promise.all([
    settleCards([
      { label: "Awaiting your approval", build: () => awaitingApprovalCard(queue.total) },
      { label: "Total employees", build: () => headcountCard() },
      { label: "This month's payroll", build: () => currentPayrollCard("/admin/payroll") },
      { label: "Attendance backlog", build: () => attendanceBacklogCard(attendanceBacklog) },
      { label: "Waiting for approval", build: async () => waitingForApprovalCard(moneyWaiting.length) },
    ]),
    payrollSeries(6),
    approvalRows(),
  ])

  return {
    role: "SUPER_ADMIN",
    greeting: {
      kicker: timeOfDayGreeting(),
      heading: "Organisation overview",
      sub:
        queue.total === 0
          ? "Nothing is waiting on you."
          : `${queue.total} decision${queue.total === 1 ? "" : "s"} waiting on you.`,
      cta: { label: "Review payroll", href: "/admin/payroll" },
    },
    stats,
    chart: { title: "Payroll disbursed", sub: "Last six months, BDT", bars },
    table: {
      title: "Waiting on you",
      headers: ["What", "Queue", "Since", "Waiting"],
      rows: waiting,
      href: "/admin/payroll",
    },
    badges: {
      "/admin/payroll": queue.total,
      "/admin/attendance": attendanceBacklog,
      // Things needing a person, not the size of the register: a badge beside
      // a nav item reads as "you have N to do", and putting the asset count
      // there would teach people the number is decoration.
      "/admin/assets": assetQueue,
      "/admin/accounting/approvals": moneyWaiting.length,
    },
  }
}
