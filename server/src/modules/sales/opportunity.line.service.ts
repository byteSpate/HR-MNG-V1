import prisma from "../../config/prisma"
import type { Prisma } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import { dec, toMoneyString } from "../payroll/payroll.money"
import { presentLine } from "./opportunity.present"
import { accountScopeFor, employeeIdFor, requireOpportunityAccess } from "./sales.access"
import type {
  CreateOpportunityLineBody, OpportunitySuggestionQuery, ReorderOpportunityLinesBody,
  UpdateOpportunityLineBody,
} from "./sales.validators"

const asClient = (tx: Prisma.TransactionClient) => tx as unknown as typeof prisma
const nullable = (value: string | undefined) => value === undefined || value === "" ? null : value

async function lineForWrite(tx: Prisma.TransactionClient, lineId: string, actor: AccessTokenPayload) {
  const line = await tx.opportunityLine.findFirst({ where: { id: lineId } })
  if (!line) throw new AppError(404, "That Opportunity line does not exist, or is not yours")
  await requireOpportunityAccess(line.opportunityId, actor, asClient(tx))
  return line
}

async function touch(tx: Prisma.TransactionClient, opportunityId: string) {
  await tx.opportunity.update({ where: { id: opportunityId }, data: { lastActivityAt: new Date() } })
}

export async function addOpportunityLine(
  opportunityId: string, body: CreateOpportunityLineBody, actor: AccessTokenPayload
) {
  return prisma.$transaction(async (tx) => {
    await requireOpportunityAccess(opportunityId, actor, asClient(tx))
    const order = ((await tx.opportunityLine.aggregate({
      where: { opportunityId }, _max: { order: true },
    }))._max.order ?? -1) + 1
    const created = await tx.opportunityLine.create({ data: {
      opportunityId, product: body.product, oemBrand: nullable(body.oemBrand),
      model: nullable(body.model), quantity: body.quantity ?? null,
      unitValue: body.unitValue === undefined ? null : dec(body.unitValue),
      // Deliberately not quantity × unitValue. Only an explicitly submitted value is stored.
      lineValue: body.lineValue === undefined ? null : dec(body.lineValue),
      note: nullable(body.note), order,
    } })
    await touch(tx, opportunityId)
    await writeAudit(tx, {
      entity: "OPPORTUNITY_LINE", entityId: created.id, action: "CREATE", changedBy: actor.sub,
      after: { opportunityId, product: created.product, order },
    })
    return presentLine(created)
  })
}

export async function updateOpportunityLine(
  lineId: string, body: UpdateOpportunityLineBody, actor: AccessTokenPayload
) {
  return prisma.$transaction(async (tx) => {
    const current = await lineForWrite(tx, lineId, actor)
    const data: Record<string, unknown> = {}
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    for (const field of ["product", "quantity"] as const) {
      if (body[field] !== undefined && body[field] !== current[field]) {
        data[field] = body[field]; before[field] = current[field]; after[field] = body[field]
      }
    }
    for (const field of ["oemBrand", "model", "note"] as const) {
      if (body[field] !== undefined) {
        const next = nullable(body[field])
        if (next !== current[field]) { data[field] = next; before[field] = current[field]; after[field] = next }
      }
    }
    for (const field of ["unitValue", "lineValue"] as const) {
      if (body[field] === undefined) continue
      const submitted = body[field]
      const stored = current[field] == null ? null : toMoneyString(dec(current[field]!))
      // Clearing a price. Distinct from leaving it alone, and emphatically
      // distinct from writing zero: an unpriced line is one nobody has costed
      // yet, and a zero-priced line is one somebody is giving away.
      if (submitted === null) {
        if (current[field] == null) continue
        data[field] = null
        before[field] = stored
        after[field] = null
        continue
      }
      const next = dec(submitted)
      if (current[field] == null || !next.equals(current[field]!)) {
        data[field] = next
        before[field] = stored
        after[field] = toMoneyString(next)
      }
    }
    if (Object.keys(data).length === 0) return presentLine(current)
    const updated = await tx.opportunityLine.update({ where: { id: lineId }, data })
    await touch(tx, current.opportunityId)
    await writeAudit(tx, {
      entity: "OPPORTUNITY_LINE", entityId: lineId, action: "UPDATE", changedBy: actor.sub,
      before: before as Prisma.InputJsonObject, after: after as Prisma.InputJsonObject,
    })
    return presentLine(updated)
  })
}

export async function deleteOpportunityLine(lineId: string, actor: AccessTokenPayload): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const current = await lineForWrite(tx, lineId, actor)
    await tx.opportunityLine.delete({ where: { id: lineId } })
    await touch(tx, current.opportunityId)
    await writeAudit(tx, {
      entity: "OPPORTUNITY_LINE", entityId: lineId, action: "DELETE", changedBy: actor.sub,
      before: { opportunityId: current.opportunityId, product: current.product, order: current.order },
    })
  })
}

export async function reorderOpportunityLines(
  opportunityId: string, body: ReorderOpportunityLinesBody, actor: AccessTokenPayload
) {
  return prisma.$transaction(async (tx) => {
    await requireOpportunityAccess(opportunityId, actor, asClient(tx))
    const current = await tx.opportunityLine.findMany({
      where: { opportunityId }, orderBy: { order: "asc" }, select: { id: true, order: true },
    })
    if (current.length !== body.lineIds.length || current.some((line) => !body.lineIds.includes(line.id))) {
      throw new AppError(400, "Reorder must include all and only this Opportunity's lines")
    }
    const oldOrder = new Map(current.map((line) => [line.id, line.order]))
    for (const [order, id] of body.lineIds.entries()) {
      if (oldOrder.get(id) === order) continue
      await tx.opportunityLine.update({ where: { id }, data: { order } })
      await writeAudit(tx, {
        entity: "OPPORTUNITY_LINE", entityId: id, action: "UPDATE", changedBy: actor.sub,
        before: { order: oldOrder.get(id) }, after: { order },
      })
    }
    await touch(tx, opportunityId)
    return { lineIds: body.lineIds }
  })
}

export async function suggestOpportunityLineValues(query: OpportunitySuggestionQuery, actor: AccessTokenPayload) {
  const employeeId = await employeeIdFor(actor)
  const column = { product: "product", brand: "oemBrand", model: "model" }[query.field]
  const groupBy = prisma.opportunityLine.groupBy as any
  const rows = await groupBy({
    by: [column],
    where: {
      [column]: { not: null, contains: query.q, mode: "insensitive" },
      opportunity: { salesAccount: accountScopeFor(actor, employeeId) },
    },
    _count: { [column]: true }, orderBy: { _count: { [column]: "desc" } }, take: 20,
  })
  return rows.map((row: Record<string, unknown>) => row[column] as string).filter(Boolean)
}
