/**
 * Reading the funnel (revision §27.6, §27.9, §27.10, §27.12, §27.14).
 *
 * Filtering and sorting happen in the database, not over a fetched array, and
 * every read is bounded. The funnel is a list that only ever grows, so the
 * unbounded-read defect the performance audit found in 191 other places is one
 * this module does not start life with.
 */

import prisma from "../../../config/prisma"
import type { Prisma } from "../../../generated/prisma/client"
import { AppError } from "../../../middleware/errorHandler"
import { dec, toMoneyString, ZERO, type Money } from "../../payroll/payroll.money"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { commentKindScopeFor, employeeIdFor, isSalesAdmin } from "../sales.access"
import { recentChangeSince, weekReviewedBy } from "./funnel.dates"
import { composeFunnel } from "./funnel.rows"
import type {
  FunnelCloseChange,
  FunnelCommentInput,
  FunnelDealInput,
  FunnelGrid,
} from "./funnel.types"
import type { FunnelQuery } from "./funnel.validators"

export const FUNNEL_NOT_YOURS = "You can only see your own funnel"
export const NO_SALES_PROFILE = "That person has no sales profile"

/**
 * How many audit rows to read while looking for closing-date moves.
 *
 * One query for the whole grid, never one per row. Five rows per deal is
 * generous, and the alternative is an unbounded read of what will become the
 * largest table in the database.
 */
const AUDIT_ROWS_PER_DEAL = 5
const READ_CAP = 2000

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
  if (query.hideClosed) where.status = { notIn: ["LOST", "CANCELLED"] }
  if (query.changedLastWeek) where.lastActivityAt = { gte: recentChangeSince(now) }

  return where
}

/** The five sorts, as an `orderBy` (§27.9). */
function orderFor(query: FunnelQuery): Prisma.OpportunityOrderByWithRelationInput[] {
  const dir = query.direction
  switch (query.sort) {
    case "status":
      return [{ status: dir }, { offeredOn: "desc" }]
    case "amount":
      return [{ amount: dir }, { offeredOn: "desc" }]
    case "expectedCloseDate":
      return [{ expectedCloseDate: dir }, { offeredOn: "desc" }]
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

  const deals = await prisma.opportunity.findMany({
    where: whereFor(subject.employeeId, query, now),
    select: DEAL_SELECT,
    orderBy: orderFor(query),
    take: query.limit,
  })

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
  })
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

function readCloseAudit(dealIds: string[]) {
  return prisma.auditLog.findMany({
    where: { entity: "OPPORTUNITY", entityId: { in: dealIds }, action: "UPDATE" },
    select: { entityId: true, before: true, after: true, changedAt: true },
    orderBy: { changedAt: "desc" },
    take: Math.min(dealIds.length * AUDIT_ROWS_PER_DEAL, READ_CAP),
  })
}

export interface FunnelTeamRow {
  employeeId: string
  employeeName: string
  dealCount: number
  quoted: string
  stillOpen: string
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

  const weekStart = weekReviewedBy(now)

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
      where: { offeredOn: { not: null }, status: { notIn: ["LOST", "CANCELLED"] } },
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

  const asMoney = (value: unknown): Money =>
    value === null || value === undefined ? ZERO : dec(value as never)

  const rows: FunnelTeamRow[] = people.map((person) => ({
    employeeId: person.id,
    employeeName: person.fullName,
    dealCount: quotedBy.get(person.id)?._count._all ?? 0,
    quoted: toMoneyString(asMoney(quotedBy.get(person.id)?._sum.amount)),
    stillOpen: toMoneyString(asMoney(openBy.get(person.id)?._sum.amount)),
    reviewed: reviewed.has(person.id),
  }))

  return { weekStart: weekStart.toISOString().slice(0, 10), rows }
}
