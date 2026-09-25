import { Prisma } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"

/** amount × ratePercent / 100, rounded to the paisa — the same rule Phase 2
 *  uses for a supplier bill line. */
export function vatFor(amount: Prisma.Decimal, ratePercent: Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(amount.times(ratePercent).dividedBy(100).toFixed(2))
}

interface VatCodeClient {
  vatCode: {
    findMany: (args: { where: { id: { in: string[] }; isActive: boolean } }) => Promise<Array<{ id: string; ratePercent: Prisma.Decimal }>>
  }
}

/** One rate lookup per write, so a rate that was deactivated between two
 *  lines on the same document is still refused rather than half-applied. */
export async function loadActiveVatRates(client: VatCodeClient, ids: string[]): Promise<Map<string, Prisma.Decimal>> {
  const uniqueIds = [...new Set(ids)]
  const codes = await client.vatCode.findMany({ where: { id: { in: uniqueIds }, isActive: true } })
  const rates = new Map<string, Prisma.Decimal>(codes.map((c) => [c.id, new Prisma.Decimal(c.ratePercent)]))
  for (const id of uniqueIds) {
    if (!rates.has(id)) throw new AppError(400, "This VAT code does not exist, or has been turned off.")
  }
  return rates
}
