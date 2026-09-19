/**
 * Composing the funnel grid (revision §27.6, §27.8, §27.10, §27.15).
 *
 * Pure: every row this needs is passed in, so the read path, the tests and any
 * later caller all build a row the same way, and none of it needs a database.
 *
 * Two of the columns are **derived and never stored**: the offer line (§27.8)
 * and the slipped-closing-date mark (§27.15). Both are composed here, on the
 * way out, which is what keeps them out of the tables.
 */

import { formatDateOnly } from "../../../utils/dates"
import { dec, sum, toMoneyString, ZERO, type Money } from "../../payroll/payroll.money"
import { monthYearOf } from "./funnel.dates"
import type {
  FunnelCloseChange,
  FunnelCommentInput,
  FunnelDealInput,
  FunnelGrid,
  FunnelLineInput,
  FunnelRemark,
  FunnelRow,
  FunnelTotals,
} from "./funnel.types"

/** Statuses that leave the "Still open" figure (§27.10). */
const CLOSED_OUT = new Set<string>(["LOST", "CANCELLED"])

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

/**
 * "Sep 5, 2026". The offer date is one we actually know, so it prints in full
 * — unlike a closing date, which is only ever as precise as its month.
 */
function offerDateLabel(date: Date): string {
  return `${SHORT_MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`
}

const iso = (date: Date | null | undefined): string | null => (date ? formatDateOnly(date) : null)

/**
 * Decimal or string in, fixed-2 string out. Null stays null — never "0.00",
 * because an unpriced deal is a real state and zero is a claim.
 */
const money = (value: unknown): string | null =>
  value === null || value === undefined ? null : toMoneyString(dec(value as never))

/**
 * One cell of the Brand, Model or Quantity columns (§27.6).
 *
 * A deal can carry several product lines and the grid has one cell. The sheet
 * writes the first and lets the reader open the row for the rest, so this does
 * the same: the first line's value, then "+N more" for however many lines
 * follow it.
 *
 * The count is of *lines*, not of lines carrying a value. A deal whose first
 * line has no brand still says "+1 more", because the honest statement is
 * "there is more here than fits", not "there is one more brand".
 */
export function summariseLines(
  lines: FunnelLineInput[],
  field: "oemBrand" | "model" | "quantity"
): string {
  if (lines.length === 0) return ""

  const ordered = [...lines].sort((a, b) => a.order - b.order)
  const raw = ordered[0][field]
  const head = raw === null || raw === undefined ? "" : String(raw)
  const rest = ordered.length - 1

  if (rest === 0) return head
  return head === "" ? `+${rest} more` : `${head} +${rest} more`
}

/** The products a deal offered, as the offer line names them. */
function productSummary(lines: FunnelLineInput[]): string {
  if (lines.length === 0) return ""
  const ordered = [...lines].sort((a, b) => a.order - b.order)
  const rest = ordered.length - 1
  return rest === 0 ? ordered[0].product : `${ordered[0].product} +${rest} more`
}

/**
 * "We have offered <product> on <date>" (§27.8).
 *
 * Composed on every read and stored nowhere. A stored version would need an
 * author, and there is no honest one to give it — inventing a name would make
 * a fake record out of a convenience.
 *
 * Null rather than a half-sentence when either half is missing.
 */
function offerLineFor(deal: FunnelDealInput): string | null {
  if (!deal.offeredOn) return null
  const products = productSummary(deal.lines)
  if (products === "") return null
  return `We have offered ${products} on ${offerDateLabel(deal.offeredOn)}`
}

interface SlipMark {
  slipped: boolean
  previous: string | null
}

/**
 * The sheet's red closing date, read out of the audit log rather than stored
 * (§27.15).
 *
 * Only the **latest** recorded change decides it. A deal whose date slipped in
 * March and was pulled forward in August is not late — marking it would teach
 * people the colour means nothing.
 *
 * A first date being set (null to a value) is filling a blank, not slipping.
 */
function slipFor(changes: FunnelCloseChange[]): SlipMark {
  if (changes.length === 0) return { slipped: false, previous: null }

  const latest = changes.reduce((newest, change) =>
    change.changedAt.getTime() > newest.changedAt.getTime() ? change : newest
  )

  if (!latest.from || !latest.to) return { slipped: false, previous: null }
  if (latest.to.getTime() <= latest.from.getTime()) return { slipped: false, previous: null }

  return { slipped: true, previous: iso(latest.from) }
}

function remarkOf(comment: FunnelCommentInput): FunnelRemark {
  return {
    id: comment.id,
    kind: comment.kind,
    body: comment.body,
    authorName: comment.authorName,
    createdAt: comment.createdAt.toISOString(),
    funnelMeetingId: comment.funnelMeetingId,
  }
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const item of items) {
    const at = key(item)
    const bucket = out.get(at)
    if (bucket) bucket.push(item)
    else out.set(at, [item])
  }
  return out
}

function totalsFor(deals: FunnelDealInput[]): FunnelTotals {
  const priced: Money[] = []
  const open: Money[] = []
  let unpricedCount = 0
  let stillOpenCount = 0

  for (const deal of deals) {
    const isOpen = !CLOSED_OUT.has(deal.status)
    if (isOpen) stillOpenCount += 1

    if (deal.amount === null || deal.amount === undefined) {
      unpricedCount += 1
      continue
    }
    const amount = dec(deal.amount as never)
    priced.push(amount)
    if (isOpen) open.push(amount)
  }

  return {
    quoted: toMoneyString(priced.length > 0 ? sum(priced) : ZERO),
    quotedCount: deals.length,
    stillOpen: toMoneyString(open.length > 0 ? sum(open) : ZERO),
    stillOpenCount,
    unpricedCount,
  }
}

export interface ComposeFunnelInput {
  employeeId: string
  employeeName: string
  deals: FunnelDealInput[]
  comments: FunnelCommentInput[]
  closeChanges: FunnelCloseChange[]
}

/**
 * The grid for one person.
 *
 * Deals arrive already filtered by the database — the service does that, so
 * the funnel does not become another of the unbounded reads the performance
 * audit found. Newest offer first is applied here as well, so an unsorted call
 * still comes back looking like the sheet.
 */
export function composeFunnel(input: ComposeFunnelInput): FunnelGrid {
  const commentsByDeal = groupBy(input.comments, (c) => c.entityId)
  const changesByDeal = groupBy(input.closeChanges, (c) => c.entityId)

  const ordered = [...input.deals].sort((a, b) => {
    const left = a.offeredOn ? a.offeredOn.getTime() : 0
    const right = b.offeredOn ? b.offeredOn.getTime() : 0
    return right - left
  })

  const rows: FunnelRow[] = ordered.map((deal, index) => {
    const slip = slipFor(changesByDeal.get(deal.id) ?? [])
    const remarks = (commentsByDeal.get(deal.id) ?? [])
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(remarkOf)

    return {
      // Screen position, renumbered on every read (§27.6).
      serialNo: index + 1,
      opportunityId: deal.id,
      serial: deal.serial,
      offeredOn: iso(deal.offeredOn),
      salesAccountId: deal.salesAccountId,
      accountName: deal.accountName,
      projectName: deal.name,
      useCase: deal.useCase,
      brand: summariseLines(deal.lines, "oemBrand"),
      model: summariseLines(deal.lines, "model"),
      quantity: summariseLines(deal.lines, "quantity"),
      lineCount: deal.lines.length,
      amount: money(deal.amount),
      status: deal.status,
      stage: deal.stage,
      closingDate: iso(deal.expectedCloseDate),
      closingDateLabel: monthYearOf(deal.expectedCloseDate),
      closingDateSlipped: slip.slipped,
      previousClosingDate: slip.previous,
      lostTo: {
        partner: deal.lostToPartner,
        amount: money(deal.lostToAmount),
        product: deal.lostToProduct,
      },
      nextStep: deal.nextStep,
      offerLine: offerLineFor(deal),
      remarks,
    }
  })

  return {
    employeeId: input.employeeId,
    employeeName: input.employeeName,
    rows,
    totals: totalsFor(input.deals),
  }
}
