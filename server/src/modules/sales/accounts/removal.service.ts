import prisma from "../../../config/prisma"
import type { Prisma } from "../../../generated/prisma/client"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { ACCOUNT_NOT_VISIBLE, employeeIdFor, isSalesAdmin } from "../sales.access"
import { assertOwnerOrAdmin } from "./account.owner-rules"
import { lockAccountRow } from "./account.service"
import { assertNoOngoingOpportunities } from "./removal.shared"

export type RemovalStatus = "PENDING" | "APPROVED" | "REFUSED" | "CANCELLED"

export interface RemovalRequestRow {
  id: string
  salesAccountId: string
  accountName: string
  employeeId: string
  employeeName: string
  requestedByName: string | null
  status: RemovalStatus
  refusalReason: string | null
  createdAt: string
  decidedAt: string | null
}

export const ONLY_OWNER_ASKS = "Only the Owner can ask to remove a collaborator."
export const REQUEST_ALREADY_DECIDED = "This request has already been decided."

type RowWithNames = {
  id: string
  salesAccountId: string
  employeeId: string
  requestedBy: string
  status: RemovalStatus
  refusalReason: string | null
  decidedAt: Date | null
  createdAt: Date
  salesAccount: { name: string }
  employee: { fullName: string }
}

/** Shared with `removal.decide.ts`: one shape, one place. */
export const ROW_INCLUDE = {
  salesAccount: { select: { name: true, ownerEmployeeId: true } },
  employee: { select: { fullName: true } },
} as const

export async function namesOf(userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)]
  if (unique.length === 0) return new Map()
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, displayName: true, email: true, employee: { select: { fullName: true } } },
  })
  return new Map(users.map((u) => [u.id, u.employee?.fullName ?? u.displayName ?? u.email]))
}

export function presentRemoval(row: RowWithNames, names: Map<string, string>): RemovalRequestRow {
  return {
    id: row.id,
    salesAccountId: row.salesAccountId,
    accountName: row.salesAccount.name,
    employeeId: row.employeeId,
    employeeName: row.employee.fullName,
    requestedByName: names.get(row.requestedBy) ?? null,
    status: row.status,
    refusalReason: row.refusalReason,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
  }
}

/**
 * The Owner asks for a collaborator to be removed. The collaborator keeps full
 * access until a Sales Admin approves. Checked under the Sales Account row
 * lock, so two requests at once cannot both pass the "already waiting" check.
 */
export async function requestRemoval(
  accountId: string,
  body: { employeeId: string },
  actor: AccessTokenPayload
): Promise<RemovalRequestRow> {
  if (isSalesAdmin(actor)) {
    throw new AppError(400, "A Sales Admin can remove a collaborator directly. No request is needed.")
  }
  const actorEmployeeId = await employeeIdFor(actor)

  const row = await prisma.$transaction(async (tx) => {
    await lockAccountRow(tx as typeof prisma, accountId)
    const account = await tx.salesAccount.findUnique({
      where: { id: accountId },
      select: { id: true, ownerEmployeeId: true, assignments: { select: { employeeId: true } } },
    })
    if (!account) throw new AppError(404, ACCOUNT_NOT_VISIBLE)
    assertOwnerOrAdmin(actor, actorEmployeeId, account.ownerEmployeeId, ONLY_OWNER_ASKS)

    if (!account.assignments.some((a) => a.employeeId === body.employeeId)) {
      throw new AppError(404, "That person is not a collaborator on this Sales Account.")
    }
    const person = await tx.employee.findUnique({ where: { id: body.employeeId }, select: { id: true, fullName: true } })
    const name = person?.fullName ?? "That person"

    await assertNoOngoingOpportunities(tx, accountId, body.employeeId, name)

    const waiting = await tx.salesCollaboratorRemoval.findFirst({
      where: { salesAccountId: accountId, employeeId: body.employeeId, status: "PENDING" },
      select: { id: true },
    })
    if (waiting) throw new AppError(409, `A request to remove ${name} is already waiting.`)

    const created = await tx.salesCollaboratorRemoval.create({
      data: { salesAccountId: accountId, employeeId: body.employeeId, requestedBy: actor.sub },
      include: ROW_INCLUDE,
    })
    await writeAudit(tx, {
      entity: "SALES_COLLABORATOR_REMOVAL",
      entityId: created.id,
      action: "CREATE",
      changedBy: actor.sub,
      after: { status: "PENDING", employeeId: body.employeeId, salesAccountId: accountId },
      note: `Request to remove ${name}`,
    })
    return created
  })

  return presentRemoval(row as unknown as RowWithNames, await namesOf([row.requestedBy]))
}

/** The person who asked can take the request back while it is waiting. */
export async function cancelRemoval(id: string, actor: AccessTokenPayload): Promise<RemovalRequestRow> {
  const row = await prisma.$transaction(async (tx) => {
    const current = await tx.salesCollaboratorRemoval.findUnique({ where: { id }, include: ROW_INCLUDE })
    if (!current) throw new AppError(404, "That request does not exist.")
    if (current.requestedBy !== actor.sub) throw new AppError(403, "Only the person who asked can cancel this request.")
    if (current.status !== "PENDING") throw new AppError(409, REQUEST_ALREADY_DECIDED)

    const updated = await tx.salesCollaboratorRemoval.update({
      where: { id },
      data: { status: "CANCELLED", decidedBy: actor.sub, decidedAt: new Date() },
      include: ROW_INCLUDE,
    })
    await writeAudit(tx, {
      entity: "SALES_COLLABORATOR_REMOVAL",
      entityId: id,
      action: "CANCEL",
      changedBy: actor.sub,
      before: { status: "PENDING" },
      after: { status: "CANCELLED" },
    })
    return updated
  })
  return presentRemoval(row as unknown as RowWithNames, await namesOf([row.requestedBy]))
}

/**
 * A Sales Admin reads every request. A Sales User reads only the ones on Sales
 * Accounts they own, so an Owner can see what became of what they asked.
 */
export async function listRemovals(
  query: { accountId?: string; status?: RemovalStatus },
  actor: AccessTokenPayload
): Promise<RemovalRequestRow[]> {
  const where: Prisma.SalesCollaboratorRemovalWhereInput = {
    ...(query.accountId ? { salesAccountId: query.accountId } : {}),
    ...(query.status ? { status: query.status } : {}),
  }
  if (!isSalesAdmin(actor)) {
    const own = await employeeIdFor(actor)
    if (!own) return []
    where.salesAccount = { ownerEmployeeId: own }
  }

  const rows = await prisma.salesCollaboratorRemoval.findMany({
    where,
    include: ROW_INCLUDE,
    orderBy: { createdAt: "desc" },
    take: 200,
  })
  const names = await namesOf(rows.map((r) => r.requestedBy))
  return rows.map((r) => presentRemoval(r as unknown as RowWithNames, names))
}
