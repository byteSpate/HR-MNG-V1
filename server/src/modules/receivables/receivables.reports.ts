import { Prisma } from "../../generated/prisma/client"

const ZERO = new Prisma.Decimal(0)

export interface OutstandingInput {
  lines: Array<{ amount: Prisma.Decimal; vatAmount: Prisma.Decimal }>
  allocations: Array<{ amount: Prisma.Decimal }>
  creditNotes: Array<{ lines: Array<{ amount: Prisma.Decimal; vatAmount: Prisma.Decimal }> }>
}

/** The select every caller of getInvoiceOutstanding needs on the invoice. */
export const OUTSTANDING_SELECT = {
  lines: { select: { amount: true, vatAmount: true } },
  allocations: { where: { receipt: { status: "APPROVED" } }, select: { amount: true } },
  creditNotes: { where: { status: "APPROVED" }, select: { lines: { select: { amount: true, vatAmount: true } } } },
} as const

/** Gross, less approved receipts' allocations (matched advances included),
 *  less approved credit notes. Drafts have not touched 1220, so they never
 *  count — the same rule Phase 2's getBillOutstanding follows. */
export function getInvoiceOutstanding(invoice: OutstandingInput): Prisma.Decimal {
  const gross = invoice.lines.reduce((sum, l) => sum.plus(l.amount).plus(l.vatAmount), ZERO)
  const collected = invoice.allocations.reduce((sum, a) => sum.plus(a.amount), ZERO)
  const credited = invoice.creditNotes.reduce(
    (sum, note) => sum.plus(note.lines.reduce((s, l) => s.plus(l.amount).plus(l.vatAmount), ZERO)),
    ZERO
  )
  return gross.minus(collected).minus(credited)
}

/** The customer's go-live opening balance less approved receipts against
 *  it — the same shape as getInvoiceOutstanding, for the debt that has no
 *  invoice behind it. */
export function getCustomerOpeningOutstanding(ob: { amount: Prisma.Decimal; allocations: Array<{ amount: Prisma.Decimal }> }): Prisma.Decimal {
  return ob.allocations.reduce((left, a) => left.minus(a.amount), new Prisma.Decimal(ob.amount))
}
