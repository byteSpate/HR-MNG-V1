/**
 * The chart of accounts.
 *
 * Full CRUD by design (Decision 10): an account is not an immutable thing.
 * What is guarded is referential danger — an account carrying any journal
 * line, or any child, cannot be deleted, and the error offers deactivation
 * instead. `code` and `type` are absent from the update schema deliberately:
 * retyping an account with posted lines would move money between statements
 * without touching a single journal.
 */

import prisma from "../../config/prisma"
import type { Account, AccountType, Prisma } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import type { AccountNode } from "./accounting.types"
import { validateAccountCode } from "./accounting.utils"
import type { CreateAccountInput, UpdateAccountInput } from "./accounting.validators"

interface ListOpts {
  type?: AccountType
  isActive?: boolean
  q?: string
}

function where(opts: ListOpts = {}): Prisma.AccountWhereInput {
  return {
    ...(opts.type ? { type: opts.type } : {}),
    ...(opts.isActive !== undefined ? { isActive: opts.isActive } : {}),
    ...(opts.q
      ? {
          OR: [
            { code: { contains: opts.q, mode: "insensitive" as const } },
            { name: { contains: opts.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  }
}

export function listAccountsFlat(opts: ListOpts = {}): Promise<Account[]> {
  return prisma.account.findMany({ where: where(opts), orderBy: { code: "asc" } })
}

/**
 * The tree, built in one pass over a single code-ordered query rather than a
 * recursive fetch per level. Because the rows arrive sorted by code, each
 * `children` array comes out sorted with no second sort.
 *
 * A filtered call can orphan a child whose parent was excluded; those are
 * promoted to roots rather than dropped, so a search never silently hides a
 * matching account.
 */
export async function listAccounts(opts: ListOpts = {}): Promise<AccountNode[]> {
  const rows = await listAccountsFlat(opts)

  const byId = new Map<string, AccountNode>()
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      code: r.code,
      name: r.name,
      type: r.type,
      isGroup: r.isGroup,
      cashKind: r.cashKind,
      isActive: r.isActive,
      systemRole: r.systemRole,
      description: r.description,
      children: [],
    })
  }

  const roots: AccountNode[] = []
  for (const r of rows) {
    const node = byId.get(r.id)!
    const parent = r.parentId ? byId.get(r.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

export async function getAccount(id: string): Promise<Account> {
  const account = await prisma.account.findUnique({ where: { id } })
  if (!account) throw new AppError(404, "Account not found")
  return account
}

/**
 * Only a group may sit at the top of the chart. The statements build every
 * line from a group (5200 Administrative & Selling Expenses and so on), so an
 * account you post to with no group above it has no line to appear on. Its
 * money is left out, and `assertChartCoversLedger` then stops every statement.
 * That happened with 5210 Water Bill on 2026-11-10.
 */
function assertSitsUnderGroup(isGroup: boolean, parentId: string | null | undefined): void {
  if (!isGroup && !parentId) {
    throw new AppError(
      400,
      "An account that takes entries must sit under a group, so the statements know which line it belongs to. Choose a group in Sits under."
    )
  }
}

export async function createAccount(
  input: CreateAccountInput,
  actor: AccessTokenPayload
): Promise<Account> {
  validateAccountCode(input.code, input.type)
  assertSitsUnderGroup(input.isGroup, input.parentId)

  return prisma.$transaction(async (tx) => {
    const clash = await tx.account.findFirst({ where: { code: input.code } })
    if (clash) {
      throw new AppError(409, `Code ${input.code} is already used by ${clash.name}`)
    }

    if (input.parentId) {
      const parent = await tx.account.findUnique({ where: { id: input.parentId } })
      if (!parent) throw new AppError(400, "Parent account not found")
      if (!parent.isGroup) {
        throw new AppError(
          400,
          "A parent must be a group. Convert it to a group first, or pick a different parent."
        )
      }
      if (parent.type !== input.type) {
        throw new AppError(
          400,
          `A ${input.type} account cannot sit under a ${parent.type} group`
        )
      }
    }

    const created = await tx.account.create({
      data: {
        code: input.code,
        name: input.name,
        type: input.type,
        parentId: input.parentId ?? null,
        isGroup: input.isGroup,
        cashKind: input.cashKind,
        description: input.description ?? null,
      },
    })

    await writeAudit(tx, {
      entity: "ACCOUNT",
      entityId: created.id,
      action: "CREATE",
      changedBy: actor.sub,
      after: { code: input.code, name: input.name, type: input.type },
    })

    return created
  })
}

/**
 * Refuse a re-parent that would put an account inside its own branch.
 *
 * Rejecting `parentId === id` catches only the one-step case. Two steps is
 * just as reachable: park A under B, then B under A. Nothing about either
 * write is individually suspicious, and the result is a loop that belongs to
 * no root — `listAccounts` attaches every node to its parent, so a cycle
 * attaches to nothing and both accounts *vanish from the chart* with no
 * error. Their balances go with them: they stay in the trial balance, which
 * is flat, while dropping out of whichever statement total they belonged to.
 *
 * Walks up from the proposed parent. The `seen` set is not redundant — it is
 * what stops this looping forever if a cycle already exists.
 */
async function assertNoCycle(
  tx: Prisma.TransactionClient,
  id: string,
  parentId: string
): Promise<void> {
  const seen = new Set<string>([id])
  let cursor: string | null = parentId

  while (cursor) {
    if (seen.has(cursor)) {
      throw new AppError(400, "That would put the account inside its own branch")
    }
    seen.add(cursor)
    const row: { parentId: string | null } | null = await tx.account.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    })
    cursor = row?.parentId ?? null
  }
}

/** Only the fields that actually changed, matching the house audit style. */
function diff<T extends Record<string, unknown>>(
  before: T,
  patch: Partial<T>
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {}
  const a: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (before[key] === value) continue
    b[key] = before[key]
    a[key] = value
  }
  return { before: b, after: a }
}

export function updateAccount(
  id: string,
  input: UpdateAccountInput,
  actor: AccessTokenPayload
): Promise<Account> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.account.findUnique({ where: { id } })
    if (!existing) throw new AppError(404, "Account not found")

    // Checked on what the account will be after this save, not only on what
    // changed. An account already saved at top level (as 5210 was) cannot be
    // edited any other way until it is given a group, which is the fix.
    assertSitsUnderGroup(
      input.isGroup ?? existing.isGroup,
      input.parentId === undefined ? existing.parentId : input.parentId
    )

    if (input.parentId) {
      if (input.parentId === id) throw new AppError(400, "An account cannot be its own parent")
      const parent = await tx.account.findUnique({ where: { id: input.parentId } })
      if (!parent) throw new AppError(400, "Parent account not found")
      if (!parent.isGroup) throw new AppError(400, "A parent must be a group")
      if (parent.type !== existing.type) {
        throw new AppError(400, `A ${existing.type} account cannot sit under a ${parent.type} group`)
      }
      await assertNoCycle(tx, id, input.parentId)
    }

    // Converting between a header and a postable account, which
    // `createAccount`'s "convert it to a group first" advice assumes exists.
    // Both directions are guarded by what already points at the account:
    // lines make it a leaf forever, children make it a group forever.
    if (input.isGroup !== undefined && input.isGroup !== existing.isGroup) {
      if (input.isGroup) {
        const lines = await tx.journalLine.count({ where: { accountId: id } })
        if (lines > 0) {
          throw new AppError(
            409,
            `${existing.name} has ${lines} journal line(s) posted to it and cannot become a group — nothing may be posted to a group.`
          )
        }
      } else {
        const children = await tx.account.count({ where: { parentId: id } })
        if (children > 0) {
          throw new AppError(
            409,
            `${existing.name} has ${children} account(s) under it and must stay a group. Move them first.`
          )
        }
      }
    }

    const updated = await tx.account.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.isGroup !== undefined ? { isGroup: input.isGroup } : {}),
        ...(input.cashKind !== undefined ? { cashKind: input.cashKind } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
    })

    const { before, after } = diff(existing as never, input as never)
    await writeAudit(tx, {
      entity: "ACCOUNT",
      entityId: id,
      action: "UPDATE",
      changedBy: actor.sub,
      before: before as Prisma.InputJsonValue,
      after: after as Prisma.InputJsonValue,
    })

    return updated
  })
}

export function deleteAccount(id: string, actor: AccessTokenPayload): Promise<void> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.account.findUnique({ where: { id } })
    if (!existing) throw new AppError(404, "Account not found")

    if (existing.systemRole) {
      throw new AppError(
        409,
        `${existing.name} carries the ${existing.systemRole} role and the statements depend on it`
      )
    }

    // Any line, not only posted ones: a draft pointing at a deleted account
    // is a broken draft, and the person who wrote it will not know why.
    const lines = await tx.journalLine.count({ where: { accountId: id } })
    if (lines > 0) {
      throw new AppError(
        409,
        `${existing.name} is used by ${lines} journal line(s) and cannot be deleted. Deactivate it instead.`
      )
    }

    const children = await tx.account.count({ where: { parentId: id } })
    if (children > 0) {
      throw new AppError(409, `${existing.name} has ${children} account(s) under it`)
    }

    await tx.account.delete({ where: { id } })

    await writeAudit(tx, {
      entity: "ACCOUNT",
      entityId: id,
      action: "DELETE",
      changedBy: actor.sub,
      before: { code: existing.code, name: existing.name },
    })
  })
}

/**
 * Invariant 3, in one place: every referenced account exists, is active, and
 * is a leaf. Shared by the journal service and by `postSystemJournal`, so a
 * generated entry is held to exactly the same rule as a typed one.
 */
export async function requirePostableAccounts(
  tx: Prisma.TransactionClient,
  accountIds: string[]
): Promise<Map<string, Account>> {
  const unique = [...new Set(accountIds)]
  const found = await tx.account.findMany({ where: { id: { in: unique } } })
  const byId = new Map(found.map((a) => [a.id, a]))

  for (const id of unique) {
    const account = byId.get(id)
    if (!account) throw new AppError(400, `Account ${id} not found`)
    if (account.isGroup) {
      throw new AppError(
        400,
        `${account.code} ${account.name} is a group. Post to one of the accounts under it.`
      )
    }
    if (!account.isActive) {
      throw new AppError(400, `${account.code} ${account.name} is inactive`)
    }
  }
  return byId
}
