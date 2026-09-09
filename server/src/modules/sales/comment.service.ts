import prisma from "../../config/prisma"
import type { Prisma, SalesCommentKind } from "../../generated/prisma/client"
import { Role, SalesRole } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import { employeeIdFor, requireAccountAccess, requireOpportunityAccess } from "./sales.access"
import type { SalesCommentPage, SalesCommentSummary } from "./sales.types"
import type { CreateSalesCommentBody, ListSalesCommentQuery, UpdateSalesCommentBody } from "./sales.validators"

const LIMIT = 100
const asClient = (tx: Prisma.TransactionClient) => tx as unknown as typeof prisma

function present(row: any): SalesCommentSummary {
  return {
    id: row.id, entity: row.entity, entityId: row.entityId, kind: row.kind,
    body: row.body, authorUserId: row.authorUserId,
    authorEmployeeId: row.authorEmployeeId ?? null,
    authorName: row.author?.fullName ?? row.authorUser?.displayName ?? row.authorUser?.email ?? "",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function authorize(
  entity: "SALES_ACCOUNT" | "OPPORTUNITY", entityId: string,
  actor: AccessTokenPayload, client: typeof prisma = prisma
) {
  if (entity === "SALES_ACCOUNT") return requireAccountAccess(entityId, actor, client)
  return requireOpportunityAccess(entityId, actor, client)
}

/**
 * Checked on the way in *and* on every later edit, against the role the caller
 * holds right now rather than the one they held when they wrote it. Authorship
 * alone is not enough: somebody who wrote a management note as an admin and
 * was afterwards demoted to Sales User is still its author, and would
 * otherwise keep editing a note their current role forbids them to write.
 */
function requireManagement(
  actor: AccessTokenPayload,
  kind: SalesCommentKind,
  verb: "written" | "edited" = "written"
) {
  if (kind !== "MANAGEMENT_NOTE") return
  if (actor.role !== Role.SUPER_ADMIN && actor.salesRole !== SalesRole.SALES_ADMIN) {
    throw new AppError(403, `A management note can only be ${verb} by a Sales Admin`)
  }
}

export async function createSalesComment(body: CreateSalesCommentBody, actor: AccessTokenPayload) {
  requireManagement(actor, body.kind)
  return prisma.$transaction(async (tx) => {
    await authorize(body.entity, body.entityId, actor, asClient(tx))
    const authorEmployeeId = await employeeIdFor(actor, asClient(tx))
    const row = await tx.salesComment.create({
      data: {
        entity: body.entity, entityId: body.entityId, kind: body.kind, body: body.body,
        authorUserId: actor.sub, authorEmployeeId, funnelMeetingId: null,
      },
      include: {
        author: { select: { fullName: true } },
        authorUser: { select: { displayName: true, email: true } },
      },
    })
    await writeAudit(tx, {
      entity: "SALES_COMMENT", entityId: row.id, action: "CREATE", changedBy: actor.sub,
      after: { entity: body.entity, entityId: body.entityId, kind: body.kind, body: body.body },
    })
    return present(row)
  })
}

export async function listSalesComments(
  query: ListSalesCommentQuery, actor: AccessTokenPayload
): Promise<SalesCommentPage> {
  await authorize(query.entity, query.entityId, actor)
  const rows = await prisma.salesComment.findMany({
    where: { entity: query.entity, entityId: query.entityId },
    orderBy: { createdAt: "desc" }, take: LIMIT + 1,
    include: {
      author: { select: { fullName: true } },
      authorUser: { select: { displayName: true, email: true } },
    },
  })
  return { items: rows.slice(0, LIMIT).map(present), truncated: rows.length > LIMIT, limit: LIMIT }
}

export async function updateSalesComment(
  id: string, body: UpdateSalesCommentBody, actor: AccessTokenPayload
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.salesComment.findUnique({
      where: { id },
      include: {
        author: { select: { fullName: true } },
        authorUser: { select: { displayName: true, email: true } },
      },
    })
    if (!current) throw new AppError(404, "That Sales comment does not exist, or is not yours")
    await authorize(current.entity as "SALES_ACCOUNT" | "OPPORTUNITY", current.entityId, actor, asClient(tx))
    requireManagement(actor, current.kind, "edited")
    if (current.authorUserId !== actor.sub) {
      throw new AppError(403, "Only the author can edit this comment")
    }
    if (current.body === body.body) return present(current)
    const updated = await tx.salesComment.update({
      where: { id }, data: { body: body.body },
      include: {
        author: { select: { fullName: true } },
        authorUser: { select: { displayName: true, email: true } },
      },
    })
    await writeAudit(tx, {
      entity: "SALES_COMMENT", entityId: id, action: "UPDATE", changedBy: actor.sub,
      before: { body: current.body }, after: { body: body.body },
    })
    return present(updated)
  })
}
