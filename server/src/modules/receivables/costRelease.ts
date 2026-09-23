import { Prisma } from "../../generated/prisma/client"
import type { Prisma as PrismaNamespace, SaleLineKind } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { loadRules, resolveAccountCode } from "../posting/posting.rules"
import { postSystemJournal } from "../accounting/accounting.posting"
import { toLedgerDate } from "../accounting/accounting.utils"
import { balanceOn } from "./receivables.position"

const ZERO = new Prisma.Decimal(0)

/**
 * The deal's current balance on a goods-holding account (1214): posted
 * debits minus credits for lines tagged with this opportunity only. Used to
 * know how much of a supplier credit note can still come out of 1214 versus
 * 5121, and how much an invoice can release.
 */
export async function heldGoodsCost(
  client: PrismaNamespace.TransactionClient | typeof prisma,
  opportunityId: string,
  goodsAccountCode: string
): Promise<Prisma.Decimal> {
  return balanceOn(client, goodsAccountCode, opportunityId)
}

export interface CostReleaseInput {
  held: Prisma.Decimal
  basis: Prisma.Decimal
  invoicedBefore: Prisma.Decimal
  invoicedNow: Prisma.Decimal
}

/**
 * Decision of 2026-09-23: with delivery not tracked, the invoice is when
 * revenue is earned, so it is also when the deal's held goods cost is
 * released, in proportion to what this invoice adds to the deal's invoiced
 * total. The invoice that reaches or passes the rest of the basis clears
 * everything still held, so no rounding residue is ever left in 1214.
 */
export function computeCostRelease({ held, basis, invoicedBefore, invoicedNow }: CostReleaseInput): Prisma.Decimal {
  if (held.lessThanOrEqualTo(0) || invoicedNow.lessThanOrEqualTo(0)) return ZERO
  const restOfBasis = basis.minus(invoicedBefore)
  if (invoicedNow.greaterThanOrEqualTo(restOfBasis)) return held
  return new Prisma.Decimal(held.times(invoicedNow).dividedBy(restOfBasis).toFixed(2))
}

export type ProgressExclusion = { invoiceId?: string; eventId?: string; runId?: string }

export interface DealProgress {
  basis: Prisma.Decimal
  progressed: Prisma.Decimal
  basisKinds: SaleLineKind[]
}

/**
 * The deal's basis (the goods value cost release is measured against — every
 * GOODS line on its POs, or every line at all when the deal has no goods
 * line, Review Focus 2) and how far it has progressed against that basis:
 * what has been invoiced on its UNTRACKED POs, plus what has been earned
 * (approved Deliveries/Acceptances, posted monthly runs) on its TRACKED
 * POs — one figure, so a deal mixing both kinds of PO is measured the same
 * way (decision B2). `exclude` leaves out the document being approved.
 */
export async function dealProgress(
  tx: PrismaNamespace.TransactionClient | typeof prisma,
  opportunityId: string,
  exclude?: ProgressExclusion
): Promise<DealProgress> {
  const poLines = await tx.customerPoLine.findMany({
    where: { po: { opportunityId, status: { in: ["OPEN", "COMPLETE"] } } },
    select: { kind: true, amount: true },
  })
  const basisKinds: SaleLineKind[] = poLines.some((l) => l.kind === "GOODS") ? ["GOODS"] : ["GOODS", "SERVICE"]
  const basis = poLines.filter((l) => basisKinds.includes(l.kind)).reduce((s, l) => s.plus(l.amount), ZERO)

  const [untrackedInvoiced, trackedEarned, monthlyEarned] = await Promise.all([
    tx.invoiceLine.findMany({
      where: {
        invoice: {
          status: "APPROVED",
          po: { opportunityId, trackDelivery: false },
          ...(exclude?.invoiceId ? { id: { not: exclude.invoiceId } } : {}),
        },
      },
      select: { amount: true, poLine: { select: { kind: true } } },
    }),
    tx.earningEventLine.findMany({
      where: {
        event: {
          status: "APPROVED",
          po: { opportunityId, trackDelivery: true },
          ...(exclude?.eventId ? { id: { not: exclude.eventId } } : {}),
        },
      },
      select: { amount: true, poLine: { select: { kind: true } } },
    }),
    tx.monthlyEarning.findMany({
      where: {
        run: { status: "POSTED", ...(exclude?.runId ? { id: { not: exclude.runId } } : {}) },
        poLine: { po: { opportunityId } },
      },
      select: { amount: true, poLine: { select: { kind: true } } },
    }),
  ])
  const progressed = [...untrackedInvoiced, ...trackedEarned, ...monthlyEarned]
    .filter((l) => basisKinds.includes(l.poLine.kind))
    .reduce((s, l) => s.plus(l.amount), ZERO)

  return { basis, progressed, basisKinds }
}

/**
 * Posts Dr DELIVERED / Cr GOODS for `progressNow` of the deal's remaining
 * basis (3a's computeCostRelease). Returns what was released; posts
 * nothing, and returns zero, when there is nothing to release.
 */
export async function releaseCostForProgress(
  tx: PrismaNamespace.TransactionClient,
  args: {
    opportunityId: string
    progressNow: Prisma.Decimal
    exclude: ProgressExclusion
    date: Date
    narration: string
    refId: string
    actorUserId: string
  }
): Promise<Prisma.Decimal> {
  const rules = await loadRules(tx, "COST_RELEASE")
  const goodsCode = resolveAccountCode(rules, "GOODS")

  const { basis, progressed } = await dealProgress(tx, args.opportunityId, args.exclude)
  const release = computeCostRelease({
    held: await heldGoodsCost(tx, args.opportunityId, goodsCode),
    basis, invoicedBefore: progressed, invoicedNow: args.progressNow,
  })
  if (release.isZero()) return release

  await postSystemJournal(tx, {
    date: args.date,
    narration: args.narration,
    source: { module: "CUSTOMER", refId: args.refId, event: "COST_RELEASE" },
    lines: [
      { accountCode: resolveAccountCode(rules, "DELIVERED"), debit: release.toFixed(2), opportunityId: args.opportunityId },
      { accountCode: goodsCode, credit: release.toFixed(2), opportunityId: args.opportunityId },
    ],
    createdBy: args.actorUserId,
  })
  return release
}

/**
 * Called from approveInvoice: posts Dr 5121 / Cr 1214 for this invoice's
 * share of the deal's held goods cost, tagged with the deal. A tracked PO's
 * invoice releases nothing here — its goods cost releases when delivered
 * (Task 8), not when billed.
 */
export async function releaseCostForInvoice(
  tx: PrismaNamespace.TransactionClient,
  invoiceId: string,
  actorUserId: string
): Promise<Prisma.Decimal> {
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: {
      id: true, date: true, invoiceNumber: true,
      po: { select: { opportunityId: true, trackDelivery: true } },
      lines: { select: { amount: true, poLine: { select: { kind: true } } } },
    },
  })
  const opportunityId = invoice.po.opportunityId
  if (invoice.po.trackDelivery) return ZERO

  const { basisKinds } = await dealProgress(tx, opportunityId, { invoiceId })
  const progressNow = invoice.lines.filter((l) => basisKinds.includes(l.poLine.kind)).reduce((s, l) => s.plus(l.amount), ZERO)

  return releaseCostForProgress(tx, {
    opportunityId, progressNow, exclude: { invoiceId },
    date: toLedgerDate(invoice.date),
    narration: `Cost of goods sold, invoice ${invoice.invoiceNumber}`,
    refId: invoiceId, actorUserId,
  })
}

/**
 * Review Focus 1: a supplier often bills after the customer has already
 * been invoiced. By then no future invoice is left to release the goods
 * cost, so a bill approved for a deal that is already fully invoiced
 * releases everything it holds at once, in one journal covering every
 * such deal on the bill. A deal still being invoiced is left alone — its
 * next invoice (Task 10) releases the new cost pro rata, same as any other.
 */
export async function releaseLateCost(
  tx: PrismaNamespace.TransactionClient,
  billId: string,
  opportunityIds: string[],
  actorUserId: string
): Promise<Prisma.Decimal> {
  const rules = await loadRules(tx, "COST_RELEASE")
  const goodsCode = resolveAccountCode(rules, "GOODS")
  const deliveredCode = resolveAccountCode(rules, "DELIVERED")

  const lines: Array<{ accountCode: string; debit?: string; credit?: string; opportunityId: string }> = []
  let total = ZERO
  for (const opportunityId of opportunityIds) {
    const { basis, progressed } = await dealProgress(tx, opportunityId)
    if (basis.lessThanOrEqualTo(0) || progressed.lessThan(basis)) continue

    const held = await heldGoodsCost(tx, opportunityId, goodsCode)
    if (held.lessThanOrEqualTo(0)) continue

    lines.push({ accountCode: deliveredCode, debit: held.toFixed(2), opportunityId })
    lines.push({ accountCode: goodsCode, credit: held.toFixed(2), opportunityId })
    total = total.plus(held)
  }
  if (lines.length === 0) return total

  await postSystemJournal(tx, {
    date: toLedgerDate(new Date()),
    narration: "Cost of goods sold, bill received after the deal was fully invoiced",
    source: { module: "CUSTOMER", refId: `bill:${billId}`, event: "COST_RELEASE" },
    lines,
    createdBy: actorUserId,
  })
  return total
}
