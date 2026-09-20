/**
 * Reading the funnel (revision §27.6, §27.9, §27.10, §27.12, §27.14).
 *
 * Filtering and sorting happen in the database, not over a fetched array, and
 * every read is bounded. The funnel is a list that only ever grows, so the
 * unbounded-read defect the performance audit found in 191 other places is one
 * this module does not start life with.
 */

import prisma from "../../../config/prisma"
import { Prisma } from "../../../generated/prisma/client"
import { AppError } from "../../../middleware/errorHandler"
import { dec, toMoneyString } from "../../payroll/payroll.money"
import { officeDateOf } from "../../attendance/attendance.time"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { commentKindScopeFor, employeeIdFor, isSalesAdmin } from "../sales.access"
import { recentChangeSince, weekReviewedBy } from "./funnel.dates"
import { composeFunnel } from "./funnel.rows"
import type {
  FunnelCloseChange,
  FunnelCommentInput,
  FunnelDealInput,
  FunnelGrid,
  FunnelTotals,
} from "./funnel.types"
import type { FunnelQuery } from "./funnel.validators"

export const FUNNEL_NOT_YOURS = "You can only see your own funnel"
export const NO_SALES_PROFILE = "That person has no sales profile"

/**
 * How many closing-date moves to read per deal. Only the latest one decides
 * the red date (§27.15), so one is enough; the cap is per deal, and applied to
 * closing-date rows only, so unrelated edits can neither crowd a deal's slip
 * out nor starve another deal's.
 */
const CLOSE_CHANGES_PER_DEAL = 1
const READ_CAP = 2000
/** Statuses that leave the "Still open" figure (§27.10). */
const CLOSED_OUT = ["LOST", "CANCELLED"] as const

/** Whose funnel is being asked for, and may this caller see it (§27.12). */
async function subjectOf(
  query: FunnelQuery,
  actor: AccessTokenPayload
): Promise<{ employeeId: string; employeeName: string }> {
  const own = await employeeIdFor(actor)
  const wanted = query.employeeId ?? own

  if (!wanted) {
    // A Super Admin has no Employee row, so there is no funnel that is
    // theirs. Saying so is better than handing back somebody else's.
    throw new AppError(404, NO_SALES_PROFILE)
  }
  if (wanted !== own && !isSalesAdmin(actor)) {
    throw new AppError(403, FUNNEL_NOT_YOURS)
  }

  const employee = await prisma.employee.findUnique({
    where: { id: wanted },
    select: { id: true, fullName: true },
  })
  if (!employee) throw new AppError(404, NO_SALES_PROFILE)

  return { employeeId: employee.id, employeeName: employee.fullName }
}

/** The grid's filters, as a `where` (§27.9). */
function whereFor(employeeId: string, query: FunnelQuery, now: Date): Prisma.OpportunityWhereInput {
  const where: Prisma.OpportunityWhereInput = {
    ownerEmployeeId: employeeId,
    // Funnel membership: quoted, and it never leaves (§27.2).
    offeredOn: { not: null },
  }

  if (query.status) where.status = query.status
  if (query.salesAccountId) where.salesAccountId = query.salesAccountId
  // Applied after `status` on purpose: asking to hide closed deals wins over
  // asking to see one, because the two together are a contradiction and the
  // narrower answer is the safer one.
  if (query.hideClosed) where.status = { notIn: [...CLOSED_OUT] }
  if (query.changedLastWeek) where.lastActivityAt = { gte: recentChangeSince(now) }

  return where
}

/** The five sorts, as an `orderBy` (§27.9). */
function orderFor(query: FunnelQuery): Prisma.OpportunityOrderByWithRelationInput[] {
  const dir = query.direction
  switch (query.sort) {
    case "status":
      return [{ status: dir }, { offeredOn: "desc" }]
    // Nulls last both ways: an unpriced deal or an undated one has no place in
    // a ranking, so it should not head the list when the direction flips.
    case "amount":
      return [{ amount: { sort: dir, nulls: "last" } }, { offeredOn: "desc" }]
    case "expectedCloseDate":
      return [{ expectedCloseDate: { sort: dir, nulls: "last" } }, { offeredOn: "desc" }]
    case "account":
      return [{ salesAccount: { name: dir } }, { offeredOn: "desc" }]
    case "offeredOn":
    default:
      // A stable second key, so two deals quoted on the same day keep their
      // order between reads instead of swapping about.
      return [{ offeredOn: dir }, { serial: "asc" }]
  }
}

const DEAL_SELECT = {
  id: true,
  serial: true,
  salesAccountId: true,
  salesAccount: { select: { name: true } },
  name: true,
  useCase: true,
  offeredOn: true,
  amount: true,
  status: true,
  stage: true,
  expectedCloseDate: true,
  lostToPartner: true,
  lostToAmount: true,
  lostToProduct: true,
  nextStep: true,
  lines: {
    select: { product: true, oemBrand: true, model: true, quantity: true, order: true },
    orderBy: { order: "asc" },
  },
} as const

/**
 * Pulls the closing-date moves out of the audit log (§27.15).
 *
 * An audit row records only the fields that changed, so one is interesting
 * exactly when `expectedCloseDate` appears in its before or its after.
 */
export function closeChangesFrom(
  rows: { entityId: string; before: unknown; after: unknown; changedAt: Date }[]
): FunnelCloseChange[] {
  const out: FunnelCloseChange[] = []

  for (const row of rows) {
    const before = row.before as Record<string, unknown> | null
    const after = row.after as Record<string, unknown> | null
    const had = Boolean(before && "expectedCloseDate" in before)
    const has = Boolean(after && "expectedCloseDate" in after)
    if (!had && !has) continue

    const read = (value: unknown): Date | null => {
      if (typeof value !== "string") return null
      const parsed = new Date(value)
      return Number.isNaN(parsed.getTime()) ? null : parsed
    }

    out.push({
      entityId: row.entityId,
      from: had ? read((before as Record<string, unknown>).expectedCloseDate) : null,
      to: has ? read((after as Record<string, unknown>).expectedCloseDate) : null,
      changedAt: row.changedAt,
    })
  }

  return out
}

/** One person's funnel (§27.6). */
export async function getFunnel(
  query: FunnelQuery,
  actor: AccessTokenPayload,
  now: Date = new Date()
): Promise<FunnelGrid> {
  const subject = await subjectOf(query, actor)

  const where = whereFor(subject.employeeId, query, now)

  // One row past the limit, so "there is more" is known rather than guessed.
  const fetched = await prisma.opportunity.findMany({
    where,
    select: DEAL_SELECT,
    orderBy: orderFor(query),
    take: query.limit + 1,
  })
  const truncated = fetched.length > query.limit
  const deals = truncated ? fetched.slice(0, query.limit) : fetched

  const dealIds = deals.map((d) => d.id)

  // Two bounded reads for the whole grid, never one per row.
  const [comments, auditRows] = await Promise.all([
    dealIds.length === 0
      ? Promise.resolve([] as Awaited<ReturnType<typeof readComments>>)
      : readComments(dealIds, actor),
    dealIds.length === 0
      ? Promise.resolve([] as Awaited<ReturnType<typeof readCloseAudit>>)
      : readCloseAudit(dealIds),
  ])

  const dealInputs: FunnelDealInput[] = deals.map((deal) => ({
    id: deal.id,
    serial: deal.serial,
    salesAccountId: deal.salesAccountId,
    accountName: deal.salesAccount.name,
    name: deal.name,
    useCase: deal.useCase,
    offeredOn: deal.offeredOn,
    amount: deal.amount,
    status: deal.status,
    stage: deal.stage,
    expectedCloseDate: deal.expectedCloseDate,
    lostToPartner: deal.lostToPartner,
    lostToAmount: deal.lostToAmount,
    lostToProduct: deal.lostToProduct,
    nextStep: deal.nextStep,
    lines: deal.lines,
  }))

  const commentInputs: FunnelCommentInput[] = comments.map((c) => ({
    id: c.id,
    entityId: c.entityId,
    kind: c.kind,
    body: c.body,
    // HR's staff name where there is one, the sign-in address otherwise —
    // which is the case for a Super Admin, who has no Employee row.
    authorName: c.author?.fullName ?? c.authorUser.email,
    createdAt: c.createdAt,
    funnelMeetingId: c.funnelMeetingId,
  }))

  return composeFunnel({
    employeeId: subject.employeeId,
    employeeName: subject.employeeName,
    deals: dealInputs,
    comments: commentInputs,
    closeChanges: closeChangesFrom(auditRows),
    // Totals over the rows in hand are the totals of the view — until the view
    // is longer than the page, when they would understate it. Then the
    // database adds up the whole of it.
    ...(truncated ? { totals: await totalsOverView(where), truncated: true } : {}),
  })
}

/**
 * Both totals over every deal the filters admit, not just the rows returned
 * (§27.10). Aggregated by the database: the point of the page limit is to not
 * read the whole funnel into memory.
 */
async function totalsOverView(where: Prisma.OpportunityWhereInput): Promise<FunnelTotals> {
  const open: Prisma.OpportunityWhereInput = {
    AND: [where, { status: { notIn: [...CLOSED_OUT] } }],
  }
  const [everything, stillOpen, unpriced] = await Promise.all([
    prisma.opportunity.aggregate({ where, _count: { _all: true }, _sum: { amount: true } }),
    prisma.opportunity.aggregate({ where: open, _count: { _all: true }, _sum: { amount: true } }),
    prisma.opportunity.count({ where: { AND: [where, { amount: null }] } }),
  ])

  // A sum over nothing priced is null, and it stays null: it is not zero.
  const asMoney = (value: unknown): string | null =>
    value === null || value === undefined ? null : toMoneyString(dec(value as never))

  return {
    quoted: asMoney(everything._sum.amount),
    quotedCount: everything._count._all,
    stillOpen: asMoney(stillOpen._sum.amount),
    stillOpenCount: stillOpen._count._all,
    unpricedCount: unpriced,
  }
}

function readComments(dealIds: string[], actor: AccessTokenPayload) {
  return prisma.salesComment.findMany({
    where: {
      entity: "OPPORTUNITY",
      entityId: { in: dealIds },
      // A management note is admin-only to read, and that rule is a `where`
      // rather than a filter over fetched rows: a caller who may not read one
      // must not cause it to be read.
      ...commentKindScopeFor(actor),
    },
    select: {
      id: true,
      entityId: true,
      kind: true,
      body: true,
      createdAt: true,
      funnelMeetingId: true,
      author: { select: { fullName: true } },
      authorUser: { select: { email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(dealIds.length * 20, READ_CAP),
  })
}

/**
 * The latest closing-date move for each deal (§27.15).
 *
 * Filtered to closing-date rows **in the database**, before any limit: reading
 * the newest N audit rows and looking for closing dates among them meant five
 * unrelated edits hid a deal's earlier slip. The window function then caps per
 * deal, so one busy deal cannot use up another's share.
 *
 * `jsonb_exists` is the function form of the `?` operator, which a driver
 * would otherwise read as a bind placeholder.
 */
function readCloseAudit(dealIds: string[]) {
  return prisma.$queryRaw<
    { entityId: string; before: unknown; after: unknown; changedAt: Date }[]
  >(Prisma.sql`
    SELECT "entityId", "before", "after", "changedAt"
    FROM (
      SELECT "entityId", "before", "after", "changedAt",
             ROW_NUMBER() OVER (PARTITION BY "entityId" ORDER BY "changedAt" DESC) AS "rank"
      FROM "AuditLog"
      WHERE "entity" = 'OPPORTUNITY'
        AND "action" = 'UPDATE'
        AND "entityId" IN (${Prisma.join(dealIds)})
        AND (jsonb_exists("before", 'expectedCloseDate') OR jsonb_exists("after", 'expectedCloseDate'))
    ) AS "changes"
    WHERE "rank" <= ${CLOSE_CHANGES_PER_DEAL}
  `)
}

export interface FunnelTeamRow {
  employeeId: string
  employeeName: string
  dealCount: number
  /** Null when nothing in the funnel is priced — not "0.00", which is a claim. */
  quoted: string | null
  stillOpen: string | null
  /** Whether this person's funnel has been walked in the week under review. */
  reviewed: boolean
}

/**
 * The admin's landing screen: one line per person (§27.14).
 *
 * Deliberately not a combined grid of everybody's deals — an admin walks one
 * person at a time, which is how the meeting is actually run (§27.17).
 *
 * The figures are aggregated by the database rather than by fetching every
 * deal and adding them up here.
 */
export async function listFunnelTeam(
  actor: AccessTokenPayload,
  now: Date = new Date()
): Promise<{ weekStart: string; rows: FunnelTeamRow[] }> {
  if (!isSalesAdmin(actor)) throw new AppError(403, FUNNEL_NOT_YOURS)

  // The office's Saturday, not the UTC one: between midnight and 06:00 in
  // Dhaka the UTC date is still Friday, which is the week before.
  const weekStart = weekReviewedBy(officeDateOf(now))

  const [people, quotedGroups, openGroups, meeting] = await Promise.all([
    prisma.employee.findMany({
      where: { user: { salesRole: { not: null }, isActive: true } },
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
    }),
    prisma.opportunity.groupBy({
      by: ["ownerEmployeeId"],
      where: { offeredOn: { not: null } },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.opportunity.groupBy({
      by: ["ownerEmployeeId"],
      where: { offeredOn: { not: null }, status: { notIn: [...CLOSED_OUT] } },
      _sum: { amount: true },
    }),
    prisma.funnelMeeting.findUnique({
      where: { weekStart },
      select: { reviews: { select: { employeeId: true } } },
    }),
  ])

  const quotedBy = new Map(quotedGroups.map((g) => [g.ownerEmployeeId, g]))
  const openBy = new Map(openGroups.map((g) => [g.ownerEmployeeId, g]))
  const reviewed = new Set((meeting?.reviews ?? []).map((r) => r.employeeId))

  const asMoney = (value: unknown): string | null =>
    value === null || value === undefined ? null : toMoneyString(dec(value as never))

  const rows: FunnelTeamRow[] = people.map((person) => ({
    employeeId: person.id,
    employeeName: person.fullName,
    dealCount: quotedBy.get(person.id)?._count._all ?? 0,
    quoted: asMoney(quotedBy.get(person.id)?._sum.amount),
    stillOpen: asMoney(openBy.get(person.id)?._sum.amount),
    reviewed: reviewed.has(person.id),
  }))

  return { weekStart: weekStart.toISOString().slice(0, 10), rows }
}
