import { Prisma } from "../../generated/prisma/client"
import type { Prisma as PrismaNamespace, SaleLineKind } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import type { SystemJournalInput } from "../accounting/accounting.types"
import { postSystemJournal } from "../accounting/accounting.posting"
import { toLedgerDate } from "../accounting/accounting.utils"
import { loadRules, resolveAccountCode } from "../posting/posting.rules"
import type { ResolvedRules } from "../posting/posting.types"
import { contractPosition, lockDeal, splitAgainst, type ContractPosition } from "./receivables.position"
import { releaseCostForProgress } from "./costRelease"
import { refreshPoStatus } from "./receivables.poStatus"
import { EARNING_EVENT_INCLUDE, poLineEarnRemaining } from "./earningEvent.service"

type Line = SystemJournalInput["lines"][number]

/**
 * EARNED (spec §3.2 step 1): Dr 2170 up to what is unearned, Dr 1221 for
 * the rest — mirroring buildInvoiceLines' split the other way round, since
 * an earning clears the liability an ahead-of-schedule invoice created
 * before it starts an asset for revenue nobody has billed yet. Cr revenue
 * per line. Every line carries the deal.
 */
export function buildEarnedLines(
  opportunityId: string,
  lines: Array<{ amount: Prisma.Decimal; kind: SaleLineKind }>,
  rules: ResolvedRules,
  position: ContractPosition
): Line[] {
  const net = lines.reduce((s, l) => s.plus(l.amount), new Prisma.Decimal(0))
  const debits: Line[] = []
  const { fromAvailable, rest } = splitAgainst(net, position.unearned)
  if (fromAvailable.greaterThan(0)) {
    debits.push({ accountCode: resolveAccountCode(rules, "UNEARNED"), debit: fromAvailable.toFixed(2), opportunityId })
  }
  if (rest.greaterThan(0)) {
    debits.push({ accountCode: resolveAccountCode(rules, "UNBILLED"), debit: rest.toFixed(2), opportunityId })
  }
  const credits = lines.map((l) => ({ accountCode: resolveAccountCode(rules, l.kind), credit: l.amount.toFixed(2), opportunityId }))
  return [...debits, ...credits]
}

export async function approveEarningEvent(id: string, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx: PrismaNamespace.TransactionClient) => {
    const head = await tx.earningEvent.findUnique({ where: { id }, select: { po: { select: { id: true, opportunityId: true } } } })
    if (!head) throw new AppError(404, "Delivery or acceptance not found")

    // Spec §3.5: events on one deal are serialised.
    await lockDeal(tx, head.po.opportunityId)

    const event = await tx.earningEvent.findUnique({
      where: { id },
      include: {
        po: { select: { id: true, serial: true, opportunityId: true } },
        lines: { include: { poLine: { select: { id: true, description: true, kind: true } } } },
      },
    })
    if (!event) throw new AppError(404, "Delivery or acceptance not found")
    if (event.status !== "DRAFT") throw new AppError(409, `This record is already ${event.status.toLowerCase()}`)
    if (event.createdBy === actor.sub) throw new AppError(403, "You prepared this record and cannot also approve it")

    // Re-check what is left on each line, since two drafts may have been
    // created at once — excluding this event's own already-counted lines.
    const poLines = await tx.customerPoLine.findMany({
      where: { poId: event.poId },
      include: {
        earningLines: { where: { eventId: { not: id }, event: { status: { in: ["DRAFT", "APPROVED"] } } }, select: { amount: true, quantity: true } },
        monthlyEarnings: { where: { run: { status: "POSTED" } }, select: { amount: true } },
      },
    })
    const mine = new Map<string, Prisma.Decimal>()
    for (const l of event.lines) mine.set(l.poLineId, (mine.get(l.poLineId) ?? new Prisma.Decimal(0)).plus(l.amount))
    for (const poLine of poLines) {
      const wanted = mine.get(poLine.id)
      if (!wanted) continue
      const remaining = poLineEarnRemaining(poLine)
      if (wanted.greaterThan(remaining.amount)) throw new AppError(400, `Only ${remaining.amount.toFixed(2)} of ${poLine.description} is left to earn`)
    }

    const [rules, position] = await Promise.all([loadRules(tx, "EARNED"), contractPosition(tx, event.po.opportunityId)])

    const updated = await tx.earningEvent.update({
      where: { id },
      data: { status: "APPROVED", approvedBy: actor.sub, approvedAt: new Date() },
      include: EARNING_EVENT_INCLUDE,
    })

    const date = toLedgerDate(event.date)
    const kindLabel = event.kind === "DELIVERY" ? "Delivery" : "Acceptance"
    await postSystemJournal(tx, {
      date,
      narration: `${kindLabel} ${event.evidenceRef} on ${event.po.serial}`,
      source: { module: "CUSTOMER", refId: id, event: "EARNED" },
      lines: buildEarnedLines(
        event.po.opportunityId,
        event.lines.map((l) => ({ amount: l.amount, kind: l.poLine.kind })),
        rules, position
      ),
      createdBy: actor.sub,
    })

    const progressNow = event.lines.reduce((s, l) => s.plus(l.amount), new Prisma.Decimal(0))
    await releaseCostForProgress(tx, {
      opportunityId: event.po.opportunityId, progressNow, exclude: { eventId: id },
      date, narration: `Cost of goods sold, ${kindLabel.toLowerCase()} ${event.evidenceRef}`,
      refId: id, actorUserId: actor.sub,
    })

    await refreshPoStatus(tx, event.poId)
    await writeAudit(tx, { entity: "EARNING_EVENT", entityId: id, action: "APPROVE", changedBy: actor.sub })
    return updated
  })
}
