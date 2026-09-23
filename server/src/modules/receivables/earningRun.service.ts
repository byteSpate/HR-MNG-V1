import { Prisma } from "../../generated/prisma/client"
import type { Prisma as PrismaNamespace } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import type { SystemJournalInput } from "../accounting/accounting.types"
import { postSystemJournal } from "../accounting/accounting.posting"
import { resolveOpenPeriod } from "../accounting/accounting.period.service"
import { toLedgerDate } from "../accounting/accounting.utils"
import { draftReversal } from "../accounting/accounting.reversal"
import { loadRules } from "../posting/posting.rules"
import { fyForMonth, monthLabel } from "../depreciation/depreciation.service"
import { contractPosition, lockDeals } from "./receivables.position"
import { releaseCostForProgress } from "./costRelease"
import { refreshPoStatus } from "./receivables.poStatus"
import { buildEarnedLines } from "./earningEvent.posting"
import { computeRunCharges } from "./earningRun.compute"

type Line = SystemJournalInput["lines"][number]

/** The last day of `year`/`month` as a UTC date — what the run posts on. */
function lastDayOf(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 0))
}

function runNoFor(year: number, month: number): string {
  return `BS-ER-${year}-${String(month).padStart(2, "0")}`
}

const RUN_DETAIL_INCLUDE = {
  journal: { select: { journalNo: true } },
  charges: {
    include: { poLine: { select: { description: true, po: { select: { serial: true, customer: { select: { legalName: true } } } } } } },
  },
} satisfies PrismaNamespace.EarningRunInclude

async function getEarningRunDetail(tx: PrismaNamespace.TransactionClient, id: string) {
  const run = await tx.earningRun.findUnique({ where: { id }, include: RUN_DETAIL_INCLUDE })
  if (!run) throw new AppError(404, "Earning run not found")
  return run
}

/**
 * Loads every MONTHLY line on an OPEN tracked PO and what it has already
 * earned from POSTED runs, then works out this month's charge per line —
 * the same shape a re-drafted (skipped) month catches up automatically,
 * since `computeRunCharges` reads target minus what is already posted.
 */
async function computeDraftCharges(tx: PrismaNamespace.TransactionClient, year: number, month: number) {
  const poLines = await tx.customerPoLine.findMany({
    where: { earnKind: "MONTHLY", po: { status: "OPEN", trackDelivery: true } },
    select: {
      id: true, amount: true, contractStart: true, contractEnd: true,
      monthlyEarnings: { where: { run: { status: "POSTED" } }, select: { amount: true } },
    },
  })
  const lines = poLines.map((l) => ({
    id: l.id,
    amount: l.amount,
    contractStart: l.contractStart!,
    contractEnd: l.contractEnd!,
    earnedSoFar: l.monthlyEarnings.reduce((s, m) => s.plus(m.amount), new Prisma.Decimal(0)),
  }))
  return computeRunCharges(lines, lastDayOf(year, month))
}

export async function draftEarningRun(body: { year: number; month: number }, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.earningRun.findUnique({
      where: { year_month: { year: body.year, month: body.month } },
      select: { id: true, runNo: true, status: true },
    })
    if (existing) {
      throw new AppError(
        409,
        `${monthLabel(body.year, body.month)} already has an earnings run (${existing.runNo}, ${existing.status.toLowerCase()}). Reversing it frees the month.`,
        { runId: existing.id }
      )
    }

    const fy = await fyForMonth(tx, body.year, body.month)
    if (!fy) throw new AppError(409, `No financial year covers ${monthLabel(body.year, body.month)}. Create one first.`)

    const charges = await computeDraftCharges(tx, body.year, body.month)

    const run = await tx.earningRun.create({
      data: {
        runNo: runNoFor(body.year, body.month),
        year: body.year,
        month: body.month,
        createdBy: actor.sub,
        charges: { create: charges.map((c) => ({ poLineId: c.poLineId, amount: c.amount.toFixed(2) })) },
      },
      include: RUN_DETAIL_INCLUDE,
    })

    await writeAudit(tx, {
      entity: "EARNING_RUN", entityId: run.id, action: "CREATE", changedBy: actor.sub,
      after: { runNo: run.runNo, year: body.year, month: body.month, chargeCount: charges.length },
    })

    return run
  })
}

export async function listEarningRuns() {
  return prisma.earningRun.findMany({
    include: { charges: { select: { id: true, amount: true } } },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  })
}

export async function getEarningRun(id: string) {
  return prisma.$transaction((tx) => getEarningRunDetail(tx, id))
}

export async function postEarningRun(id: string, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx: PrismaNamespace.TransactionClient) => {
    const run = await tx.earningRun.findUnique({
      where: { id },
      include: { charges: { include: { poLine: { select: { id: true, kind: true, po: { select: { id: true, opportunityId: true } } } } } } },
    })
    if (!run) throw new AppError(404, "Earning run not found")
    if (run.status !== "DRAFT") {
      throw new AppError(409, `${run.runNo} is ${run.status}; only a DRAFT run can be posted. Reverse it to free the month.`)
    }
    if (run.charges.length === 0) throw new AppError(409, `${run.runNo} has nothing to post. Delete the draft instead.`)

    const byDeal = new Map<string, typeof run.charges>()
    for (const c of run.charges) {
      const dealId = c.poLine.po.opportunityId
      byDeal.set(dealId, [...(byDeal.get(dealId) ?? []), c])
    }
    const dealIds = [...byDeal.keys()]
    await lockDeals(tx, dealIds)

    const rules = await loadRules(tx, "EARNED")
    const journalDate = toLedgerDate(lastDayOf(run.year, run.month))
    await resolveOpenPeriod(tx, journalDate)

    const allLines: Line[] = []
    for (const dealId of dealIds) {
      const charges = byDeal.get(dealId)!
      const position = await contractPosition(tx, dealId)
      allLines.push(...buildEarnedLines(dealId, charges.map((c) => ({ amount: c.amount, kind: c.poLine.kind })), rules, position))
    }

    const journal = await postSystemJournal(tx, {
      date: journalDate,
      narration: `Monthly contract earnings, ${monthLabel(run.year, run.month)}`,
      source: { module: "CUSTOMER", refId: run.id, event: `EARNED:${run.year}-${String(run.month).padStart(2, "0")}` },
      lines: allLines,
      createdBy: actor.sub,
    })

    // Each deal's cost release is its own journal — one combined EARNED
    // journal above, but a shared refId here would collide with the unique
    // (module, refId, event) index the moment a second deal also releases
    // cost in the same run, so each deal's release is tagged `runId:dealId`.
    for (const dealId of dealIds) {
      const charges = byDeal.get(dealId)!
      const progressNow = charges.reduce((s, c) => s.plus(c.amount), new Prisma.Decimal(0))
      await releaseCostForProgress(tx, {
        opportunityId: dealId, progressNow, exclude: { runId: id },
        date: journalDate, narration: `Cost of goods sold, monthly contract earnings ${monthLabel(run.year, run.month)}`,
        refId: `${id}:${dealId}`, actorUserId: actor.sub,
      })
    }

    const poIds = [...new Set(run.charges.map((c) => c.poLine.po.id))]
    for (const poId of poIds) await refreshPoStatus(tx, poId)

    await tx.earningRun.update({
      where: { id }, data: { status: "POSTED", journalId: journal.id, postedBy: actor.sub, postedAt: new Date() },
    })

    await writeAudit(tx, {
      entity: "EARNING_RUN", entityId: id, action: "APPROVE", changedBy: actor.sub,
      before: { status: "DRAFT" }, after: { status: "POSTED", journalNo: journal.journalNo },
    })

    return getEarningRunDetail(tx, id)
  })
}

/**
 * Drafts a reversal for the earnings journal and for every COST_RELEASE
 * journal this run posted (one per deal, Task 13's `runId:dealId` refId).
 * Reversed charges stop counting toward `earnedSoFar` (their run is no
 * longer POSTED), so re-drafting the month recomputes them from scratch.
 */
export async function reverseEarningRun(id: string, body: { reason: string }, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx: PrismaNamespace.TransactionClient) => {
    if (!body.reason?.trim()) throw new AppError(400, "Give a reason for the reversal")

    const run = await tx.earningRun.findUnique({ where: { id } })
    if (!run) throw new AppError(404, "Earning run not found")
    if (run.status !== "POSTED" || !run.journalId) {
      throw new AppError(409, `${run.runNo} is ${run.status.toLowerCase()}; only a POSTED run with a journal can be reversed.`)
    }

    const earnedReversal = await draftReversal(tx, run.journalId, body.reason, actor.sub)

    const costReleaseJournals = await tx.journal.findMany({
      where: { sourceModule: "CUSTOMER", sourceRefId: { startsWith: `${id}:` }, sourceEvent: "COST_RELEASE", status: "POSTED" },
      select: { id: true },
    })
    for (const j of costReleaseJournals) await draftReversal(tx, j.id, body.reason, actor.sub)

    await tx.earningRun.update({ where: { id }, data: { status: "REVERSED", reversedBy: actor.sub, reversedAt: new Date() } })

    await writeAudit(tx, {
      entity: "EARNING_RUN", entityId: id, action: "REVERSE", changedBy: actor.sub,
      before: { status: "POSTED" }, after: { status: "REVERSED", reversedBy: earnedReversal.journalNo }, note: body.reason,
    })

    return getEarningRunDetail(tx, id)
  })
}

export async function deleteEarningRun(id: string, actor: AccessTokenPayload): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const run = await tx.earningRun.findUnique({ where: { id } })
    if (!run) throw new AppError(404, "Earning run not found")
    if (run.status === "POSTED") throw new AppError(409, `${run.runNo} is posted; it cannot be deleted. Reverse it instead.`)
    if (run.status === "REVERSED") throw new AppError(409, `${run.runNo} is already reversed; the month is free to re-run.`)

    await tx.earningRun.delete({ where: { id } })

    await writeAudit(tx, {
      entity: "EARNING_RUN", entityId: id, action: "DELETE", changedBy: actor.sub,
      before: { runNo: run.runNo, year: run.year, month: run.month },
    })
  })
}
