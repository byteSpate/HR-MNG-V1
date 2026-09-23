import type { CustomerPoStatus, Prisma as PrismaNamespace } from "../../generated/prisma/client"
import { poLineRemaining } from "./customerPo.service"
import { poLineEarnRemaining } from "./earningEvent.service"

/**
 * OPEN → COMPLETE when every line is fully invoiced by approved invoices
 * and, on a tracked PO, fully earned by approved events and posted runs.
 * A PO that is already CANCELLED or COMPLETE is returned unchanged — this
 * only ever moves a PO forward, never back.
 */
export async function refreshPoStatus(tx: PrismaNamespace.TransactionClient, poId: string): Promise<CustomerPoStatus> {
  const po = await tx.customerPo.findUniqueOrThrow({
    where: { id: poId },
    select: {
      status: true, trackDelivery: true,
      lines: {
        select: {
          amount: true, quantity: true,
          invoiceLines: { where: { invoice: { status: "APPROVED" } }, select: { amount: true } },
          earningLines: { where: { event: { status: "APPROVED" } }, select: { amount: true, quantity: true } },
          monthlyEarnings: { where: { run: { status: "POSTED" } }, select: { amount: true } },
        },
      },
    },
  })
  if (po.status !== "OPEN") return po.status

  const fullyInvoiced = po.lines.every((l) => poLineRemaining(l).lessThanOrEqualTo(0))
  const fullyEarned = !po.trackDelivery || po.lines.every((l) => poLineEarnRemaining(l).amount.lessThanOrEqualTo(0))

  if (!fullyInvoiced || !fullyEarned) return "OPEN"

  await tx.customerPo.update({ where: { id: poId }, data: { status: "COMPLETE" } })
  return "COMPLETE"
}
