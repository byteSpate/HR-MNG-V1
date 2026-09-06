import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import { emitEvent } from "../event/event.emit"
import type { AccessTokenPayload } from "../auth/auth.types"
import type { CreateSalesAccountBody } from "./sales.validators"
import type { SalesAccountSummary } from "./sales.types"
import { accountScopeFor, employeeIdFor } from "./sales.access"

/**
 * One sentence, used by both paths that can find a clash — the check inside
 * the transaction and the database a moment later. Naming the existing owner
 * is the difference between a dead end and a phone call, so the racing
 * caller must not get a lesser message than everyone else.
 */
function duplicateNameMessage(existingName: string, ownerName: string): string {
  return `"${existingName}" already exists and is owned by ${ownerName}. Talk to them before creating a second one.`
}

function findClash(client: typeof prisma, name: string) {
  return client.salesAccount.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    include: { owner: { select: { fullName: true } } },
  })
}

export async function createSalesAccount(
  body: CreateSalesAccountBody,
  actor: AccessTokenPayload
): Promise<SalesAccountSummary> {
  try {
    return await prisma.$transaction(async (tx) => {
      // `name @unique` is exact-match only, so the case-insensitive refusal is
      // here rather than in the database.
      const clash = await findClash(tx as typeof prisma, body.name)
      if (clash) {
        throw new AppError(409, duplicateNameMessage(clash.name, clash.owner.fullName))
      }

      const owner = await tx.employee.findUnique({
        where: { id: body.ownerEmployeeId },
        select: { id: true, fullName: true },
      })
      if (!owner) {
        throw new AppError(400, "That owner is not an employee")
      }

      // The owner is already on the account. Storing them again as an
      // assignment is the same fact twice, and the two copies drift.
      //
      // Deduped as well: a repeated id violates
      // @@unique([salesAccountId, employeeId]), which the error middleware
      // renders as a 500 for what is really a harmless double-click.
      const extras = [...new Set(body.assigneeIds ?? [])].filter((id) => id !== owner.id)

      if (extras.length > 0) {
        // The relation is required, so the database would refuse an unknown id
        // anyway — but as a P2003 the error middleware renders it as a 500.
        // Checking first turns that into the same 400 the owner field already
        // gives, instead of two different answers to one mistake. One query,
        // not one per id.
        const found = await tx.employee.findMany({
          where: { id: { in: extras } },
          select: { id: true },
        })
        const known = new Set(found.map((employee) => employee.id))
        for (const id of extras) {
          if (!known.has(id)) {
            throw new AppError(400, `${id} is not an employee`)
          }
        }
      }

      const account = await tx.salesAccount.create({
        data: {
          name: body.name,
          industry: body.industry ?? null,
          website: body.website ?? null,
          address: body.address ?? null,
          ownerEmployeeId: owner.id,
          createdBy: actor.sub,
        },
      })

      if (extras.length > 0) {
        await tx.salesAccountAssignment.createMany({
          data: extras.map((employeeId) => ({
            salesAccountId: account.id,
            employeeId,
            assignedBy: actor.sub,
          })),
        })
      }

      await writeAudit(tx, {
        entity: "SALES_ACCOUNT",
        entityId: account.id,
        action: "CREATE",
        changedBy: actor.sub,
        after: { name: account.name, ownerEmployeeId: owner.id, status: account.status },
      })

      await emitEvent(tx, {
        type: "sales.account.created",
        entity: "SALES_ACCOUNT",
        entityId: account.id,
        actorUserId: actor.sub,
        subjectEmployeeId: owner.id,
        // Explicit null suppresses the reporting-line lookup. A sales account
        // is not a fact about somebody's manager.
        managerEmployeeId: null,
        title: `${account.name} added to the Sales Hub`,
        meta: `Owner: ${owner.fullName}`,
        href: `/accounts/${account.id}`,
      })

      return {
        id: account.id,
        name: account.name,
        status: account.status,
        ownerEmployeeId: owner.id,
        ownerName: owner.fullName,
        assigneeCount: extras.length,
        createdAt: account.createdAt.toISOString(),
      }
    })
  } catch (err) {
    // Two admins submitting the same name in the same instant both pass the
    // check above and both insert; the loser lands here. Caught around the
    // transaction and not inside it, matching `createCategory` — the failed
    // statement has already aborted the transaction, so the re-read has to
    // happen on a fresh connection.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      const clash = await findClash(prisma, body.name)
      throw clash
        ? new AppError(409, duplicateNameMessage(clash.name, clash.owner.fullName))
        : new AppError(409, `"${body.name}" already exists`)
    }
    throw err
  }
}

/** Shared so the list and the detail page cannot describe an account differently. */
const SUMMARY_INCLUDE = {
  owner: { select: { fullName: true } },
  _count: { select: { assignments: true } },
} as const

type AccountRow = {
  id: string
  name: string
  status: SalesAccountSummary["status"]
  ownerEmployeeId: string
  createdAt: Date
  owner: { fullName: string }
  _count: { assignments: number }
}

function toSummary(account: AccountRow): SalesAccountSummary {
  return {
    id: account.id,
    name: account.name,
    status: account.status,
    ownerEmployeeId: account.ownerEmployeeId,
    ownerName: account.owner.fullName,
    assigneeCount: account._count.assignments,
    createdAt: account.createdAt.toISOString(),
  }
}

export async function listSalesAccounts(
  actor: AccessTokenPayload
): Promise<SalesAccountSummary[]> {
  const employeeId = await employeeIdFor(actor)
  const accounts = await prisma.salesAccount.findMany({
    where: accountScopeFor(actor, employeeId),
    orderBy: { name: "asc" },
    include: SUMMARY_INCLUDE,
  })
  return accounts.map(toSummary)
}

export async function getSalesAccount(
  id: string,
  actor: AccessTokenPayload
): Promise<SalesAccountSummary> {
  const employeeId = await employeeIdFor(actor)
  // The scope is part of the lookup rather than a check after it, so there is
  // no branch where a caller reads a row they may not see.
  const account = await prisma.salesAccount.findFirst({
    where: { AND: [{ id }, accountScopeFor(actor, employeeId)] },
    include: SUMMARY_INCLUDE,
  })
  // 404 and not 403: a 403 would confirm that an account exists to somebody
  // who is not allowed to know that it does.
  if (!account) {
    throw new AppError(404, "That Sales Account does not exist, or is not yours")
  }
  return toSummary(account)
}
