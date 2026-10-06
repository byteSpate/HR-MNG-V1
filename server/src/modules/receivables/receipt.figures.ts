import { Prisma } from "../../generated/prisma/client"
import type { Prisma as PrismaNamespace } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { getInvoiceOutstanding, OUTSTANDING_SELECT } from "./receivables.reports"

type InvoiceClient = Pick<PrismaNamespace.TransactionClient, "invoice">

const ZERO = new Prisma.Decimal(0)

/** One invoice just before a new payment is counted. */
export interface InvoiceFigures {
  /** Gross, less approved credit notes. */
  total: Prisma.Decimal
  /** What is still owed: the total, less approved payments. */
  outstanding: Prisma.Decimal
}

export async function loadInvoiceFigures(client: InvoiceClient, invoiceIds: string[]): Promise<Map<string, InvoiceFigures>> {
  const invoices = await client.invoice.findMany({
    where: { id: { in: invoiceIds } },
    select: { id: true, ...OUTSTANDING_SELECT },
  })
  return new Map(
    invoices.map((inv) => {
      const gross = inv.lines.reduce((sum, l) => sum.plus(l.amount).plus(l.vatAmount), ZERO)
      const credited = inv.creditNotes.reduce(
        (sum, note) => sum.plus(note.lines.reduce((s, l) => s.plus(l.amount).plus(l.vatAmount), ZERO)),
        ZERO
      )
      return [inv.id, { total: gross.minus(credited), outstanding: getInvoiceOutstanding(inv) }]
    })
  )
}

export interface SavedFigures {
  invoiceId: string
  amount: Prisma.Decimal
  invoiceTotal: Prisma.Decimal
  balanceAfter: Prisma.Decimal
}

/**
 * The rows saved with a new receipt: for each invoice it pays, the amount, the
 * invoice total and the balance left once this payment counts. Two lines for
 * the same invoice become one row, so the receipt shows one balance per
 * invoice. The figures are saved and never worked out again.
 */
export function savedFigures(
  allocations: Array<{ invoiceId: string; amount: Prisma.Decimal }>,
  before: Map<string, InvoiceFigures>
): SavedFigures[] {
  const paid = new Map<string, Prisma.Decimal>()
  for (const a of allocations) paid.set(a.invoiceId, (paid.get(a.invoiceId) ?? ZERO).plus(a.amount))

  return [...paid].map(([invoiceId, amount]) => {
    const figures = before.get(invoiceId)
    if (!figures) throw new AppError(404, "Invoice not found. Reload the page and try again.")
    return { invoiceId, amount, invoiceTotal: figures.total, balanceAfter: figures.outstanding.minus(amount) }
  })
}
