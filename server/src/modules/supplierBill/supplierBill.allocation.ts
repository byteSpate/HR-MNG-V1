import { Prisma } from "../../generated/prisma/client"
import type { Prisma as PrismaNamespace } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { getBillOutstanding, getOpeningOutstanding } from "./supplierBill.reports"

type Client = Pick<PrismaNamespace.TransactionClient, "supplierBill">
type OpeningClient = Pick<PrismaNamespace.TransactionClient, "supplierOpeningBalance">

/**
 * Every allocation must settle a real, approved bill of the same supplier,
 * for no more than that bill still owes. Without this, an over-allocation
 * clears 2111 below what the bills say is owed, and the control tie-out
 * stops agreeing with no way to find out which entry did it.
 */
export async function assertAllocatable(
  client: Client,
  supplierId: string,
  allocations: Array<{ billId: string; amount: string }>
): Promise<void> {
  if (allocations.length === 0) return

  const ids = [...new Set(allocations.map((a) => a.billId))]
  const bills = await client.supplierBill.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, supplierId: true, status: true, billNumber: true,
      lines: { select: { amount: true, vatAmount: true } },
      allocations: { where: { payment: { status: "APPROVED" } }, select: { amount: true } },
      creditNotes: { where: { status: "APPROVED" }, select: { lines: { select: { amount: true, vatAmount: true } } } },
    },
  })
  const byId = new Map(bills.map((b) => [b.id, b]))

  const requested = new Map<string, Prisma.Decimal>()
  for (const a of allocations) {
    requested.set(a.billId, (requested.get(a.billId) ?? new Prisma.Decimal(0)).plus(a.amount))
  }

  for (const [billId, amount] of requested) {
    const bill = byId.get(billId)
    if (!bill) throw new AppError(404, "A bill being paid does not exist")
    if (bill.supplierId !== supplierId) throw new AppError(400, `Bill ${bill.billNumber} belongs to a different supplier`)
    if (bill.status !== "APPROVED") throw new AppError(409, `Bill ${bill.billNumber} is not approved yet`)

    const outstanding = getBillOutstanding(bill)
    if (amount.greaterThan(outstanding)) {
      throw new AppError(400, `Bill ${bill.billNumber} only has ${outstanding.toFixed(2)} left to pay`)
    }
  }
}

/**
 * Phase 2 gap, fixed here: a supplier's opening balance (what we owed on
 * go-live) has no bill behind it, so a payment against it needs its own
 * guard rather than assertAllocatable's bill lookup.
 */
export async function assertOpeningPayable(
  client: OpeningClient,
  supplierId: string,
  amount: Prisma.Decimal
): Promise<{ openingBalanceId: string }> {
  const ob = await client.supplierOpeningBalance.findUnique({
    where: { supplierId },
    include: { allocations: { where: { payment: { status: "APPROVED" } }, select: { amount: true } } },
  })
  if (!ob) throw new AppError(400, "This supplier has no opening balance")

  const left = getOpeningOutstanding(ob)
  if (amount.greaterThan(left)) {
    throw new AppError(400, `The opening balance only has ${left.toFixed(2)} left to pay`)
  }
  return { openingBalanceId: ob.id }
}
