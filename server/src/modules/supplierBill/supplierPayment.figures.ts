import { Prisma } from "../../generated/prisma/client"
import type { Prisma as PrismaNamespace } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { getBillOutstanding } from "./supplierBill.reports"

type BillClient = Pick<PrismaNamespace.TransactionClient, "supplierBill">

const ZERO = new Prisma.Decimal(0)

/** One supplier bill just before a new payment is counted. All in taka. */
export interface BillFigures {
  /** Gross, less approved credit notes. */
  total: Prisma.Decimal
  /** What is still owed: the total, less approved payments. */
  outstanding: Prisma.Decimal
  currency: "BDT" | "USD"
  /** The bill's own frozen rate. Set only for a bill in US dollars. */
  fxRateToBdt: Prisma.Decimal | null
}

export async function loadBillFigures(client: BillClient, billIds: string[]): Promise<Map<string, BillFigures>> {
  const bills = await client.supplierBill.findMany({
    where: { id: { in: billIds } },
    select: {
      id: true, currency: true, fxRateToBdt: true,
      lines: { select: { amount: true, vatAmount: true } },
      allocations: { where: { payment: { status: "APPROVED" } }, select: { amount: true } },
      creditNotes: { where: { status: "APPROVED" }, select: { lines: { select: { amount: true, vatAmount: true } } } },
    },
  })
  return new Map(
    bills.map((bill) => {
      const gross = bill.lines.reduce((sum, l) => sum.plus(l.amount).plus(l.vatAmount), ZERO)
      const credited = bill.creditNotes.reduce(
        (sum, note) => sum.plus(note.lines.reduce((s, l) => s.plus(l.amount).plus(l.vatAmount), ZERO)),
        ZERO
      )
      return [bill.id, { total: gross.minus(credited), outstanding: getBillOutstanding(bill), currency: bill.currency, fxRateToBdt: bill.fxRateToBdt }]
    })
  )
}

export interface SavedFigures {
  billId: string
  /** Taka cleared against the bill. */
  amount: Prisma.Decimal
  amountUsd: Prisma.Decimal | null
  billTotal: Prisma.Decimal
  balanceAfter: Prisma.Decimal
  billTotalUsd: Prisma.Decimal | null
  balanceAfterUsd: Prisma.Decimal | null
}

/**
 * The rows saved with a new payment: for each bill it pays, the amount, the
 * bill total and the balance left once this payment counts. Two lines for the
 * same bill become one row. The figures are saved and never worked out again.
 * A bill in US dollars also gets its two figures in dollars, at its own rate.
 */
export function savedFigures(
  allocations: Array<{ billId: string; amount: string; amountUsd: string | null }>,
  before: Map<string, BillFigures>
): SavedFigures[] {
  const paid = new Map<string, { amount: Prisma.Decimal; amountUsd: Prisma.Decimal | null }>()
  for (const a of allocations) {
    const now = paid.get(a.billId)
    paid.set(a.billId, {
      amount: (now?.amount ?? ZERO).plus(a.amount),
      amountUsd: a.amountUsd === null ? (now?.amountUsd ?? null) : (now?.amountUsd ?? ZERO).plus(a.amountUsd),
    })
  }

  return [...paid].map(([billId, { amount, amountUsd }]) => {
    const figures = before.get(billId)
    if (!figures) throw new AppError(404, "Bill not found. Reload the page and try again.")
    const balanceAfter = figures.outstanding.minus(amount)
    const rate = figures.currency === "USD" ? figures.fxRateToBdt : null
    return {
      billId, amount, amountUsd,
      billTotal: figures.total,
      balanceAfter,
      billTotalUsd: rate ? figures.total.div(rate).toDecimalPlaces(2) : null,
      balanceAfterUsd: rate ? balanceAfter.div(rate).toDecimalPlaces(2) : null,
    }
  })
}
