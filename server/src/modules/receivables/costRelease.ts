import { Prisma } from "../../generated/prisma/client"
import type { Prisma as PrismaNamespace } from "../../generated/prisma/client"
import prisma from "../../config/prisma"

const ZERO = new Prisma.Decimal(0)

/**
 * The deal's current balance on a goods-holding account (1214): posted
 * debits minus credits for lines tagged with this opportunity only. Used to
 * know how much of a supplier credit note can still come out of 1214 versus
 * 5121, and, from Task 9 onward, how much an invoice can release.
 */
export async function heldGoodsCost(
  client: PrismaNamespace.TransactionClient | typeof prisma,
  opportunityId: string,
  goodsAccountCode: string
): Promise<Prisma.Decimal> {
  const account = await client.account.findUniqueOrThrow({ where: { code: goodsAccountCode }, select: { id: true } })
  const agg = await client.journalLine.aggregate({
    where: { accountId: account.id, opportunityId, journal: { status: { in: ["POSTED", "REVERSED"] } } },
    _sum: { debit: true, credit: true },
  })
  return (agg._sum.debit ?? ZERO).minus(agg._sum.credit ?? ZERO)
}
