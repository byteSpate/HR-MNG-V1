import type { Prisma } from "../../generated/prisma/client"

/** Transactional `BS-OPP-00001` issuer; the counter update and insert commit together. */
export async function nextOpportunitySerial(tx: Prisma.TransactionClient): Promise<string> {
  const counter = await tx.idCounter.upsert({
    where: { id: "OPP" },
    update: { value: { increment: 1 } },
    create: { id: "OPP", value: 1 },
  })
  return `BS-OPP-${String(counter.value).padStart(5, "0")}`
}
