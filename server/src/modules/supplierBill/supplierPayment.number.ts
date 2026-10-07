import type { Prisma } from "../../generated/prisma/client"

/**
 * Transactional `PV-0001` issuer for supplier payment vouchers, the same
 * mechanism as the customer receipt number. The counter update commits with
 * the payment, so two payments saved at the same moment cannot share a number.
 * A save that rolls back can leave a gap. A number is never used twice.
 */
export async function nextPaymentVoucherNumber(tx: Prisma.TransactionClient): Promise<string> {
  const counter = await tx.idCounter.upsert({
    where: { id: "PV" },
    update: { value: { increment: 1 } },
    create: { id: "PV", value: 1 },
  })
  return `PV-${String(counter.value).padStart(4, "0")}`
}
