import type { Prisma } from "../../generated/prisma/client"

/**
 * Transactional `MR-0001` issuer for money receipts, the same mechanism as the
 * Opportunity serial. The counter update commits with the receipt, so two
 * payments saved at the same moment cannot share a number. A save that rolls
 * back can leave a gap. A number is never used twice.
 */
export async function nextReceiptNumber(tx: Prisma.TransactionClient): Promise<string> {
  const counter = await tx.idCounter.upsert({
    where: { id: "MR" },
    update: { value: { increment: 1 } },
    create: { id: "MR", value: 1 },
  })
  return `MR-${String(counter.value).padStart(4, "0")}`
}
