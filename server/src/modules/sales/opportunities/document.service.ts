import prisma from "../../../config/prisma"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { isSalesAdmin, requireOpportunityAccess } from "../sales.access"
import type { DocumentLinkSummary } from "../sales.types"
import type { AddDocumentLinkBody } from "./opportunity.validators"

const NOT_FOUND = "That link does not exist, or is not yours"

async function namesFor(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map()
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(userIds)] } },
    select: { id: true, displayName: true, email: true, employee: { select: { fullName: true } } },
  })
  return new Map(users.map((u) => [u.id, u.employee?.fullName ?? u.displayName ?? u.email]))
}

function present(row: any, names: Map<string, string>, actor: AccessTokenPayload): DocumentLinkSummary {
  return {
    id: row.id, opportunityId: row.opportunityId, name: row.name, url: row.url, stage: row.stage,
    createdBy: row.createdBy, createdByName: names.get(row.createdBy) ?? null,
    createdAt: row.createdAt.toISOString(),
    canRemove: row.createdBy === actor.sub || isSalesAdmin(actor),
  }
}

/** Every version of every file linked to this Opportunity, newest first. */
export async function listDocumentLinks(opportunityId: string, actor: AccessTokenPayload): Promise<DocumentLinkSummary[]> {
  await requireOpportunityAccess(opportunityId, actor)
  const rows = await prisma.opportunityDocumentLink.findMany({ where: { opportunityId }, orderBy: { createdAt: "desc" } })
  const names = await namesFor(rows.map((r) => r.createdBy))
  return rows.map((r) => present(r, names, actor))
}

/**
 * A web address for a file kept outside the app (spec 2026-09-28 §1.5). The
 * file is never uploaded or copied, so nothing is overwritten: a new version
 * is a new link and the old one stays.
 */
export async function addDocumentLink(opportunityId: string, body: AddDocumentLinkBody, actor: AccessTokenPayload): Promise<DocumentLinkSummary> {
  return prisma.$transaction(async (tx) => {
    await requireOpportunityAccess(opportunityId, actor, tx as unknown as typeof prisma)
    const opp = await tx.opportunity.findFirst({ where: { id: opportunityId }, select: { stage: true } })
    const row = await tx.opportunityDocumentLink.create({
      data: { opportunityId, name: body.name, url: body.url, stage: body.stage ?? opp!.stage, createdBy: actor.sub },
    })
    await writeAudit(tx, {
      entity: "OPPORTUNITY_DOCUMENT_LINK", entityId: row.id, action: "CREATE", changedBy: actor.sub,
      after: { opportunityId, name: row.name, url: row.url, stage: row.stage },
    })
    return present(row, await namesFor([actor.sub]), actor)
  })
}

export async function removeDocumentLink(linkId: string, actor: AccessTokenPayload): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.opportunityDocumentLink.findUnique({ where: { id: linkId } })
    if (!row) throw new AppError(404, NOT_FOUND)
    await requireOpportunityAccess(row.opportunityId, actor, tx as unknown as typeof prisma)
    if (row.createdBy !== actor.sub && !isSalesAdmin(actor)) {
      throw new AppError(403, "Only the person who added this link, or a Sales Admin, can remove it.")
    }
    await tx.opportunityDocumentLink.delete({ where: { id: linkId } })
    await writeAudit(tx, {
      entity: "OPPORTUNITY_DOCUMENT_LINK", entityId: linkId, action: "DELETE", changedBy: actor.sub,
      before: { opportunityId: row.opportunityId, name: row.name, url: row.url },
    })
  })
}
