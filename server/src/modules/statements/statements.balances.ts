/**
 * The one query primitive, and the account-tree index every statement walks.
 *
 * This is the only file in the module that touches Prisma. Keeping the
 * ledger filter and the CLOSING-exclusion rule in a single place is the
 * point: three statements remembering the same two clauses correctly is
 * three chances to get it wrong.
 *
 * Nothing here writes. There is no create, update, delete or $transaction
 * anywhere in this module.
 */

import prisma from "../../config/prisma"
import type { AccountType, CashFlowKind, JournalStatus } from "../../generated/prisma/client"
import { Prisma } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { formatBdt, signedBalance } from "../accounting/accounting.utils"

export const ZERO = new Prisma.Decimal(0)

/**
 * Slice 1 Decision 16. REVERSED means "posted, then superseded by a posted
 * reversal", not "unposted" — drop it and an approved reversal moves the
 * account by minus the original amount instead of back to zero.
 */
const IN_LEDGER: { in: JournalStatus[] } = { in: ["POSTED", "REVERSED"] }

export interface AccountBalance {
  debit: Prisma.Decimal
  credit: Prisma.Decimal
  /** Positive when the account sits on its normal side. */
  signed: Prisma.Decimal
}

export type BalanceMap = Map<string, AccountBalance>

export interface ChartAccount {
  id: string
  code: string
  name: string
  type: AccountType
  parentId: string | null
  isGroup: boolean
  isActive: boolean
  systemRole: string | null
  noteRef: string | null
  cashFlowKind: CashFlowKind
  depreciationRate: Prisma.Decimal | null
  contraAccountId: string | null
}

export interface ChartIndex {
  all: ChartAccount[]
  byId: Map<string, ChartAccount>
  byRole: Map<string, ChartAccount>
  byNoteRef: Map<string, ChartAccount>
  childrenOf(accountId: string): ChartAccount[]
  leavesUnder(accountId: string): ChartAccount[]
  equityRoot: ChartAccount | null
}

export async function loadChart(): Promise<ChartIndex> {
  // One code-ordered query. Because the rows arrive sorted, every children
  // array comes out sorted with no second sort anywhere downstream.
  const all = await prisma.account.findMany({
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      parentId: true,
      isGroup: true,
      isActive: true,
      systemRole: true,
      noteRef: true,
      cashFlowKind: true,
      depreciationRate: true,
      contraAccountId: true,
    },
  })

  const byId = new Map(all.map((a) => [a.id, a]))
  const byRole = new Map(all.filter((a) => a.systemRole).map((a) => [a.systemRole!, a]))
  const byNoteRef = new Map(all.filter((a) => a.noteRef).map((a) => [a.noteRef!, a]))

  const children = new Map<string, ChartAccount[]>()
  for (const account of all) {
    if (!account.parentId) continue
    const list = children.get(account.parentId) ?? []
    list.push(account)
    children.set(account.parentId, list)
  }

  const childrenOf = (accountId: string) => children.get(accountId) ?? []

  const leavesUnder = (accountId: string): ChartAccount[] => {
    const root = byId.get(accountId)
    if (!root) return []
    if (!root.isGroup) return [root]
    return childrenOf(accountId).flatMap((child) => leavesUnder(child.id))
  }

  const equityRoot = all.find((a) => a.type === "EQUITY" && a.parentId === null) ?? null

  return { all, byId, byRole, byNoteRef, childrenOf, leavesUnder, equityRoot }
}

/**
 * Account balances for a window.
 *
 * `from` omitted means from inception, which is what a balance sheet needs;
 * supplying it gives movement within the window, which is what a profit and
 * loss needs.
 *
 * `excludeClosing` drops the year-end journal. Every profit-and-loss
 * aggregation must set it: the closing entry credits every expense account
 * and debits every revenue account on the last day of the year, so an
 * unfiltered sum over that year nets each P&L account to zero and the
 * report reads as a page of dashes the moment it becomes final.
 *
 * Cash-flow reporting may also exclude `OPENING` journals from movements,
 * or load only the opening journal posted on the first day of its period.
 */
export async function balancesFor(opts: {
  from?: Date
  to: Date
  excludeClosing: boolean
  excludeOpening?: boolean
  onlyOpening?: boolean
}): Promise<BalanceMap> {
  const excludedTypes = [
    ...(opts.excludeClosing ? ["CLOSING" as const] : []),
    ...(opts.excludeOpening ? ["OPENING" as const] : []),
  ]
  const journalType: Prisma.EnumJournalTypeFilter<"Journal"> | "OPENING" | undefined = opts.onlyOpening
    ? "OPENING" as const
    : excludedTypes.length === 1
      ? { not: excludedTypes[0] }
      : excludedTypes.length > 1
        ? { notIn: excludedTypes }
        : undefined
  const where: Prisma.JournalLineWhereInput = {
    journal: {
      status: IN_LEDGER,
      ...(journalType ? { type: journalType } : {}),
      date: { ...(opts.from ? { gte: opts.from } : {}), lte: opts.to },
    },
  }
  const [rows, accounts] = await Promise.all([
    prisma.journalLine.groupBy({
      by: ["accountId"],
      where,
      _sum: { debit: true, credit: true },
    }),
    prisma.account.findMany({ select: { id: true, type: true } }),
  ])

  const typeById = new Map(accounts.map((a) => [a.id, a.type]))
  const out: BalanceMap = new Map()

  for (const row of rows) {
    const type = typeById.get(row.accountId)
    if (!type) continue // an account deleted between the two queries
    const debit = row._sum.debit ?? ZERO
    const credit = row._sum.credit ?? ZERO
    out.set(row.accountId, { debit, credit, signed: signedBalance(type, debit, credit) })
  }

  return out
}

/** The signed total of every leaf under a group. Zero for an empty group. */
export function sumLeaves(chart: ChartIndex, balances: BalanceMap, rootId: string): Prisma.Decimal {
  return chart
    .leavesUnder(rootId)
    .reduce((total, leaf) => total.plus(balances.get(leaf.id)?.signed ?? ZERO), ZERO)
}

/**
 * Spec Decision 8: no financial statement is produced from an unbalanced
 * trial balance.
 *
 * Checked cumulatively to the end date rather than across the range, because
 * that is what the balance sheet reads — and if the cumulative position
 * agrees, no window inside it can disagree.
 *
 * In practice this can only fail through data corruption, since every posted
 * journal is balanced at the point of posting. It is a safety net, and the
 * error carries the figures so the net is useful rather than merely present.
 */
export async function assertLedgerBalanced(to: Date): Promise<void> {
  const agg = await prisma.journalLine.aggregate({
    where: { journal: { status: IN_LEDGER, date: { lte: to } } },
    _sum: { debit: true, credit: true },
  })

  const debitTotal = agg._sum?.debit ?? ZERO
  const creditTotal = agg._sum?.credit ?? ZERO
  if (debitTotal.equals(creditTotal)) return

  const difference = debitTotal.minus(creditTotal).abs()
  throw new AppError(
    409,
    `The trial balance does not agree at ${to.toISOString().slice(0, 10)}: debit ${formatBdt(
      debitTotal
    )} against credit ${formatBdt(creditTotal)}. Financial statements cannot be produced until it does.`,
    {
      debitTotal: debitTotal.toFixed(2),
      creditTotal: creditTotal.toFixed(2),
      difference: difference.toFixed(2),
      to: to.toISOString(),
    }
  )
}

/**
 * The second guard, and the one `assertLedgerBalanced` structurally cannot
 * give: every account carrying a balance must be *reachable from a statement
 * entry point*.
 *
 * A trial balance is flat, so it agrees whatever shape the tree is in. The
 * statements are not: each total is a descent from a roled group, or from the
 * equity root. An account that no descent reaches contributes to no total —
 * its balance simply is not in the document, while the trial balance it was
 * checked against still ties. Then `Assets = Liabilities + Equity + Profit`
 * stops holding, and the design treats that as an identity rather than a
 * check, so nothing downstream notices.
 *
 * Three ways an account gets there, none of them exotic:
 *   - a cycle in `parentId`, which detaches a whole loop from every root
 *   - an account created directly under `1000 Assets` rather than under
 *     `1100` or `1200`, so it is under a root but under no *section*
 *   - a re-parent that moves a subtree out from under its roled group
 *
 * Note the entry points are not "the roots". Reachability from a root is a
 * weaker property and would pass the second case above.
 *
 * The error names the accounts, because "the balance sheet does not balance"
 * sends someone hunting through journals, and "1300 Widget Deposits is not
 * under any statement section" is a two-minute fix in the chart.
 */
const SECTION_ROLES = [
  "NON_CURRENT_ASSETS",
  "CURRENT_ASSETS",
  "CURRENT_LIABILITIES",
  "NON_CURRENT_LIABILITIES",
  "REVENUE",
  "OTHER_INCOME",
  "COST_OF_SALES",
  "ADMIN_SELLING",
  "FINANCIAL_EXPENSE",
  "TAX_EXPENSE",
] as const

export function assertChartCoversLedger(chart: ChartIndex, balances: BalanceMap): void {
  const covered = new Set<string>()
  for (const role of SECTION_ROLES) {
    const group = chart.byRole.get(role)
    if (group) for (const leaf of chart.leavesUnder(group.id)) covered.add(leaf.id)
  }
  // Equity is found by type, not by role — see spec Decision 14 — so its root
  // is an entry point in its own right. Without one, the equity section is
  // empty and there is nothing to cover for it.
  if (chart.equityRoot) {
    for (const leaf of chart.leavesUnder(chart.equityRoot.id)) covered.add(leaf.id)
  }

  const orphans = [...balances.entries()]
    .filter(([id, balance]) => !covered.has(id) && !balance.signed.isZero())
    .map(([id]) => chart.byId.get(id))
    .filter((a): a is NonNullable<typeof a> => a !== undefined)
    .sort((a, b) => a.code.localeCompare(b.code))

  if (orphans.length === 0) return

  const named = orphans.map((a) => `${a.code} ${a.name}`).join(", ")
  throw new AppError(
    409,
    `${named} ${orphans.length === 1 ? "carries a balance but sits" : "carry balances but sit"} under no statement section, so the statements would not account for the whole ledger. Re-parent ${orphans.length === 1 ? "it" : "them"} under the right group in the chart of accounts.`,
    { accountIds: orphans.map((a) => a.id), codes: orphans.map((a) => a.code) }
  )
}

/**
 * Spec Decision 9. An active account appears even at nil, because a stable
 * row structure is the entire point of a comparative column — the filed
 * statements show Inventories and Revenue as dashes in both years for
 * exactly that reason.
 *
 * A deactivated account disappears, unless it still carries a balance in
 * either period, in which case hiding it would break the totals. Pruning a
 * statement is then just deactivating what you do not use, which Finance can
 * do from the chart of accounts without anybody writing code.
 */
export function isVisible(
  account: Pick<ChartAccount, "isActive">,
  current: Prisma.Decimal,
  comparative: Prisma.Decimal
): boolean {
  return account.isActive || !current.isZero() || !comparative.isZero()
}

export function assertEveryAccountClassified(chart: ChartIndex, balances: BalanceMap): void {
  const accumDep = chart.byRole.get("PPE_ACCUM_DEP")
  const excluded = new Set<string>(accumDep ? chart.leavesUnder(accumDep.id).map((a) => a.id) : [])
  const retained = chart.byRole.get("RETAINED_EARNINGS")
  if (retained) excluded.add(retained.id)

  const orphans = [...balances.entries()]
    .filter(([id, balance]) => {
      if (balance.signed.isZero() || excluded.has(id)) return false
      const account = chart.byId.get(id)
      if (!account) return false
      if (account.type === "INCOME" || account.type === "EXPENSE") return false
      return account.cashFlowKind === "NONE"
    })
    .map(([id]) => chart.byId.get(id)!)
    .sort((a, b) => a.code.localeCompare(b.code))

  if (orphans.length === 0) return
  const named = orphans.map((a) => `${a.code} ${a.name}`).join(", ")
  throw new AppError(
    409,
    `${named} ${orphans.length === 1 ? "carries a balance but has" : "carry balances but have"} no cash-flow classification, so their movements would be missing from the Statement of Cash Flows. Set a cash-flow section on them in the chart of accounts.`,
    { accountIds: orphans.map((a) => a.id), codes: orphans.map((a) => a.code) }
  )
}
