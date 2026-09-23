import { Prisma } from "../../generated/prisma/client"
import type { Prisma as PrismaNamespace, SaleLineKind } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { loadRules, resolveAccountCode } from "../posting/posting.rules"
import { postSystemJournal } from "../accounting/accounting.posting"
import { toLedgerDate } from "../accounting/accounting.utils"

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
  const account = await client.account.findUniqueOrThrow({ where: { code: goodsAccountCode }, select: { id: true } })
  const agg = await client.journalLine.aggregate({
    where: { accountId: account.id, opportunityId, journal: { status: { in: ["POSTED", "REVERSED"] } } },
    _sum: { debit: true, credit: true },
  })
  return (agg._sum.debit ?? ZERO).minus(agg._sum.credit ?? ZERO)
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

export interface DealInvoicing {
  basis: Prisma.Decimal
  invoiced: Prisma.Decimal
  basisKinds: SaleLineKind[]
}

/**
 * The deal's basis (the goods value cost release is measured against — every
 * GOODS line on its POs, or every line at all when the deal has no goods
 * line, Review Focus 2) and what has been invoiced against that basis so
 * far. `excludeInvoiceId` leaves one invoice's lines out, for the approval
 * about to add them back on top.
 */
export async function dealInvoicing(
  tx: PrismaNamespace.TransactionClient | typeof prisma,
  opportunityId: string,
  excludeInvoiceId?: string
): Promise<DealInvoicing> {
  const poLines = await tx.customerPoLine.findMany({
    where: { po: { opportunityId, status: { in: ["OPEN", "COMPLETE"] } } },
    select: { kind: true, amount: true },
  })
  const basisKinds: SaleLineKind[] = poLines.some((l) => l.kind === "GOODS") ? ["GOODS"] : ["GOODS", "SERVICE"]
  const basis = poLines.filter((l) => basisKinds.includes(l.kind)).reduce((s, l) => s.plus(l.amount), ZERO)

  const invoicedLines = await tx.invoiceLine.findMany({
    where: {
      invoice: {
        status: "APPROVED",
        po: { opportunityId },
        ...(excludeInvoiceId ? { id: { not: excludeInvoiceId } } : {}),
      },
    },
    select: { amount: true, poLine: { select: { kind: true } } },
  })
  const invoiced = invoicedLines.filter((l) => basisKinds.includes(l.poLine.kind)).reduce((s, l) => s.plus(l.amount), ZERO)

  return { basis, invoiced, basisKinds }
}

/**
 * Called from approveInvoice (Task 10): posts Dr 5121 / Cr 1214 for this
 * invoice's share of the deal's held goods cost, tagged with the deal.
 * Posts nothing, and returns zero, when there is nothing to release.
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
      po: { select: { opportunityId: true } },
      lines: { select: { amount: true, poLine: { select: { kind: true } } } },
    },
  })
  const opportunityId = invoice.po.opportunityId
  const rules = await loadRules(tx, "COST_RELEASE")
  const goodsCode = resolveAccountCode(rules, "GOODS")

  const { basis, invoiced, basisKinds } = await dealInvoicing(tx, opportunityId, invoiceId)
  const invoicedNow = invoice.lines
    .filter((l) => basisKinds.includes(l.poLine.kind))
    .reduce((s, l) => s.plus(l.amount), ZERO)

  const release = computeCostRelease({
    held: await heldGoodsCost(tx, opportunityId, goodsCode),
    basis, invoicedBefore: invoiced, invoicedNow,
  })
  if (release.isZero()) return release

  await postSystemJournal(tx, {
    date: toLedgerDate(invoice.date),
    narration: `Cost of goods sold, invoice ${invoice.invoiceNumber}`,
    source: { module: "CUSTOMER", refId: invoiceId, event: "COST_RELEASE" },
    lines: [
      { accountCode: resolveAccountCode(rules, "DELIVERED"), debit: release.toFixed(2), opportunityId },
      { accountCode: goodsCode, credit: release.toFixed(2), opportunityId },
    ],
    createdBy: actorUserId,
  })
  return release
}
