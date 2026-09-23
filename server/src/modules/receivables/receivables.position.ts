import { Prisma } from "../../generated/prisma/client"
import type { Prisma as PrismaNamespace } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { loadRules, resolveAccountCode } from "../posting/posting.rules"

const ZERO = new Prisma.Decimal(0)

/**
 * Row-locks one deal. Everything that reads or moves its 1221/2170 position
 * or its held cost calls this first, inside its transaction.
 */
export async function lockDeal(tx: PrismaNamespace.TransactionClient, opportunityId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Opportunity" WHERE "id" = ${opportunityId} FOR UPDATE`
}

/**
 * Several deals, each once, in ascending id order so concurrent callers
 * cannot deadlock over the same two deals taken in opposite order.
 */
export async function lockDeals(tx: PrismaNamespace.TransactionClient, opportunityIds: string[]): Promise<void> {
  for (const id of [...new Set(opportunityIds)].sort()) await lockDeal(tx, id)
}

/** Takes `amount` from `available` first (a negative available counts as none). */
export function splitAgainst(
  amount: Prisma.Decimal,
  available: Prisma.Decimal
): { fromAvailable: Prisma.Decimal; rest: Prisma.Decimal } {
  const fromAvailable = Prisma.Decimal.min(amount, Prisma.Decimal.max(available, ZERO))
  return { fromAvailable, rest: amount.minus(fromAvailable) }
}

/** Posted debits minus credits on one account for one deal. */
export async function balanceOn(
  client: PrismaNamespace.TransactionClient | typeof prisma,
  accountCode: string,
  opportunityId: string
): Promise<Prisma.Decimal> {
  const account = await client.account.findUniqueOrThrow({ where: { code: accountCode }, select: { id: true } })
  const agg = await client.journalLine.aggregate({
    where: { accountId: account.id, opportunityId, journal: { status: { in: ["POSTED", "REVERSED"] } } },
    _sum: { debit: true, credit: true },
  })
  return (agg._sum.debit ?? ZERO).minus(agg._sum.credit ?? ZERO)
}

export interface ContractPosition {
  unbilled: Prisma.Decimal
  unearned: Prisma.Decimal
}

/**
 * 1221's debit balance and 2170's credit balance for the deal, each floored
 * at zero. Codes come from the EARNED rules' UNBILLED and UNEARNED keys.
 */
export async function contractPosition(tx: PrismaNamespace.TransactionClient, opportunityId: string): Promise<ContractPosition> {
  const rules = await loadRules(tx, "EARNED")
  const [unbilled, unearned] = await Promise.all([
    balanceOn(tx, resolveAccountCode(rules, "UNBILLED"), opportunityId),
    balanceOn(tx, resolveAccountCode(rules, "UNEARNED"), opportunityId),
  ])
  return { unbilled: Prisma.Decimal.max(unbilled, ZERO), unearned: Prisma.Decimal.max(unearned.negated(), ZERO) }
}
