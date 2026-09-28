import { Prisma } from "../../generated/prisma/client"
import type { Prisma as PrismaNamespace } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { getInvoiceOutstanding, OUTSTANDING_SELECT } from "./receivables.reports"

type InvoiceClient = Pick<PrismaNamespace.TransactionClient, "invoice">

/**
 * Every allocation must settle a real, approved invoice of the same
 * customer, for no more than that invoice still owes — the receivables
 * mirror of Phase 2's assertAllocatable.
 */
export async function assertReceivable(
  client: InvoiceClient,
  customerId: string,
  allocations: Array<{ invoiceId: string; amount: Prisma.Decimal }>
): Promise<void> {
  if (allocations.length === 0) return

  const wanted = new Map<string, Prisma.Decimal>()
  for (const a of allocations) {
    wanted.set(a.invoiceId, (wanted.get(a.invoiceId) ?? new Prisma.Decimal(0)).plus(a.amount))
  }

  const invoices = await client.invoice.findMany({
    where: { id: { in: [...wanted.keys()] } },
    select: { id: true, invoiceNumber: true, customerId: true, status: true, ...OUTSTANDING_SELECT },
  })
  const byId = new Map(invoices.map((i) => [i.id, i]))

  for (const [invoiceId, amount] of wanted) {
    const invoice = byId.get(invoiceId)
    if (!invoice) throw new AppError(404, "One of the invoices you picked does not exist.")
    if (invoice.customerId !== customerId) throw new AppError(400, `Invoice ${invoice.invoiceNumber} belongs to a different customer`)
    if (invoice.status !== "APPROVED") {
      throw new AppError(409, `Invoice ${invoice.invoiceNumber} is not approved yet. Approve it before recording a payment against it.`)
    }

    const left = getInvoiceOutstanding(invoice)
    if (amount.greaterThan(left)) {
      throw new AppError(400, `Invoice ${invoice.invoiceNumber} only has ${left.toFixed(2)} left to collect`)
    }
  }
}
