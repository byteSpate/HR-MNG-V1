import { Prisma } from "../../generated/prisma/client"
import type { Prisma as PrismaNamespace } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import { assertDealAccess, isFinance } from "./receivables.access"
import type { CreateEarningEventInput } from "./earningEvent.validators"

export const EARNING_EVENT_INCLUDE = {
  po: {
    select: {
      id: true, serial: true, opportunityId: true,
      customer: { select: { id: true, legalName: true } },
      opportunity: { select: { id: true, serial: true, name: true } },
    },
  },
  lines: { include: { poLine: { select: { description: true, kind: true } } } },
} satisfies Prisma.EarningEventInclude

/**
 * Net and quantity left to earn on a tracked PO line: its amount and
 * quantity less every earning-event line passed in (a draft-and-approved
 * set when checking what a new event may still record, approved-only when
 * asking whether the line is complete), less every posted monthly earning.
 */
export function poLineEarnRemaining(line: {
  amount: Prisma.Decimal
  quantity: Prisma.Decimal
  earningLines: Array<{ amount: Prisma.Decimal; quantity: Prisma.Decimal | null }>
  monthlyEarnings: Array<{ amount: Prisma.Decimal }>
}): { amount: Prisma.Decimal; quantity: Prisma.Decimal } {
  let amount = new Prisma.Decimal(line.amount)
  let quantity = new Prisma.Decimal(line.quantity)
  for (const el of line.earningLines) {
    amount = amount.minus(el.amount)
    if (el.quantity) quantity = quantity.minus(el.quantity)
  }
  for (const me of line.monthlyEarnings) amount = amount.minus(me.amount)
  return { amount, quantity }
}

const PO_FOR_EARNING = {
  lines: {
    include: {
      earningLines: { where: { event: { status: { in: ["DRAFT", "APPROVED"] } } }, select: { amount: true, quantity: true } },
      monthlyEarnings: { where: { run: { status: "POSTED" } }, select: { amount: true } },
    },
  },
} satisfies Prisma.CustomerPoInclude

type PoForEarning = Prisma.CustomerPoGetPayload<{ include: typeof PO_FOR_EARNING }>

async function loadTrackedOpenPo(
  tx: PrismaNamespace.TransactionClient,
  poId: string,
  actor: AccessTokenPayload
): Promise<PoForEarning> {
  const po = await tx.customerPo.findUnique({ where: { id: poId }, include: PO_FOR_EARNING })
  if (!po) throw new AppError(404, "Customer PO not found")
  await assertDealAccess(tx, actor, po.opportunityId)
  if (!po.trackDelivery) throw new AppError(400, `PO ${po.serial} does not track delivery: its revenue is earned when invoiced`)
  if (po.status !== "OPEN") throw new AppError(400, `PO ${po.serial} is ${po.status.toLowerCase()}, so nothing more can be earned on it`)
  return po
}

function buildEventLines(po: PoForEarning, kind: "DELIVERY" | "ACCEPTANCE", lines: CreateEarningEventInput["lines"]) {
  const byId = new Map(po.lines.map((l) => [l.id, l]))
  return lines.map((l) => {
    const poLine = byId.get(l.poLineId)
    if (!poLine) throw new AppError(400, `A line on this record is not a line on PO ${po.serial}`)
    if (poLine.earnKind === "MONTHLY") throw new AppError(400, `${poLine.description} is earned by the monthly run, not recorded here`)
    if (poLine.earnKind !== kind) {
      throw new AppError(400, `${poLine.description} is earned by ${poLine.earnKind!.toLowerCase()}, not by ${kind.toLowerCase()}`)
    }

    const remaining = poLineEarnRemaining(poLine)
    if (kind === "DELIVERY") {
      if (!l.quantity) throw new AppError(400, `Give the quantity delivered for ${poLine.description}`)
      const quantity = new Prisma.Decimal(l.quantity)
      if (quantity.greaterThan(remaining.quantity)) {
        throw new AppError(400, `Only ${remaining.quantity.toFixed(2)} of ${poLine.description} is left to deliver`)
      }
      const amount = quantity.equals(remaining.quantity) ? remaining.amount : quantity.times(poLine.unitPrice)
      return { poLineId: l.poLineId, quantity: quantity.toFixed(2), amount: amount.toFixed(2) }
    }

    if (!l.amount) throw new AppError(400, `Give the amount accepted for ${poLine.description}`)
    const amount = new Prisma.Decimal(l.amount)
    if (amount.greaterThan(remaining.amount)) {
      throw new AppError(400, `Only ${remaining.amount.toFixed(2)} of ${poLine.description} is left to accept`)
    }
    return { poLineId: l.poLineId, amount: amount.toFixed(2) }
  })
}

export async function createEarningEvent(input: CreateEarningEventInput, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    const po = await loadTrackedOpenPo(tx, input.poId, actor)
    const lines = buildEventLines(po, input.kind, input.lines)

    const event = await tx.earningEvent.create({
      data: {
        poId: po.id,
        kind: input.kind,
        date: new Date(input.date),
        evidenceRef: input.evidenceRef.trim(),
        note: input.note?.trim() || null,
        createdBy: actor.sub,
        lines: { create: lines },
      },
      include: EARNING_EVENT_INCLUDE,
    })
    await writeAudit(tx, {
      entity: "EARNING_EVENT", entityId: event.id, action: "CREATE", changedBy: actor.sub,
      after: { poId: po.id, kind: input.kind, evidenceRef: event.evidenceRef },
    })
    return event
  })
}

export async function listEarningEvents(
  filter: { status?: "DRAFT" | "APPROVED"; poId?: string; opportunityId?: string },
  actor: AccessTokenPayload
) {
  if (!isFinance(actor)) {
    if (!filter.opportunityId) throw new AppError(400, "Choose a deal to list its deliveries and acceptances")
    await assertDealAccess(prisma, actor, filter.opportunityId)
  }
  return prisma.earningEvent.findMany({
    where: {
      status: filter.status,
      poId: filter.poId,
      po: filter.opportunityId ? { opportunityId: filter.opportunityId } : undefined,
    },
    include: EARNING_EVENT_INCLUDE,
    orderBy: { date: "desc" },
  })
}

export async function getEarningEvent(id: string, actor: AccessTokenPayload) {
  const event = await prisma.earningEvent.findUnique({ where: { id }, include: EARNING_EVENT_INCLUDE })
  if (!event) throw new AppError(404, "Delivery or acceptance not found")
  await assertDealAccess(prisma, actor, event.po.opportunityId)
  return event
}
