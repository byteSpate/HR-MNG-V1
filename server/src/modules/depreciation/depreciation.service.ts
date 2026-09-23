/**
 * The run service — draft, post, reverse, delete.
 *
 * `draftRun` assembles the eligible assets (joining category → PPE account
 * through the posting rules, and the chart for rates), computes the charges
 * purely, and stores one `AssetDepreciation` row per charge under a new run.
 * `postRun` turns those charges into one aggregated journal dated the last
 * day of the run's month. Everything lives inside the caller's `$transaction`
 * so a closed period rolls the whole thing back.
 */

import prisma from "../../config/prisma"
import type { DepreciationRunStatus, Prisma } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import { postSystemJournal } from "../accounting/accounting.posting"
import { resolveOpenPeriod } from "../accounting/accounting.period.service"
import { toLedgerDate } from "../accounting/accounting.utils"
import { draftReversal } from "../accounting/accounting.reversal"
import { loadRules, resolveAccountCode } from "../posting/posting.rules"
import { dec, round2, sum, ZERO } from "../payroll/payroll.money"
import { computeCharges, type ComputedCharge, type DepreciableAsset } from "./depreciation.compute"
import { buildDepreciationLines } from "./depreciation.posting"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`
}

async function nextRunNo(tx: Prisma.TransactionClient): Promise<string> {
  const counter = await tx.idCounter.upsert({
    where: { id: "DEP" },
    update: { value: { increment: 1 } },
    create: { id: "DEP", value: 1 },
  })
  return `BS-DEP-${String(counter.value).padStart(5, "0")}`
}

/** The last day of `year`/`month` as a UTC date — what the run posts on. */
function monthEnd(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 0))
}

/**
 * The financial year whose periods include the target month, or null. The
 * caller resolves `fyStartMonth` from it so a catch-up spanning a year-end
 * computes the two halves at their own rates.
 */
export async function fyForMonth(
  tx: Prisma.TransactionClient,
  year: number,
  month: number
): Promise<{ startDate: Date } | null> {
  const period = await tx.accountingPeriod.findFirst({
    where: { year, month },
    include: { financialYear: { select: { startDate: true } } },
  })
  return period?.financialYear ?? null
}

/** The months between two month indices, inclusive. */
const monthIndexOf = (year: number, month: number) => year * 12 + (month - 1)

interface RunCharge {
  id: string
  assetId: string
  amount: Prisma.Decimal
  openingBookValue: Prisma.Decimal
  rate: Prisma.Decimal
  months: number
  asset?: { assetTag: string; name: string; categoryName?: string }
}

export interface DepreciationRunDetail {
  id: string
  runNo: string
  year: number
  month: number
  status: DepreciationRunStatus
  journalId: string | null
  journal?: { journalNo: string } | null
  createdBy: string
  createdAt: Date
  postedBy: string | null
  postedAt: Date | null
  reversedBy: string | null
  reversedAt: Date | null
  charges: RunCharge[]
}

export interface DepreciationRunSummary {
  id: string
  runNo: string
  year: number
  month: number
  status: DepreciationRunStatus
  journalId: string | null
  chargeCount: number
  total: string
}

const summarySelect = {
  id: true, runNo: true, year: true, month: true, status: true, journalId: true,
  charges: { select: { id: true, amount: true } },
} as const

function toSummary(row: {
  id: string; runNo: string; year: number; month: number; status: DepreciationRunStatus;
  journalId: string | null; charges: Array<{ id: string; amount: Prisma.Decimal }>
}): DepreciationRunSummary {
  return {
    id: row.id,
    runNo: row.runNo,
    year: row.year,
    month: row.month,
    status: row.status,
    journalId: row.journalId,
    chargeCount: row.charges.length,
    total: sum(row.charges.map((c) => c.amount)).toFixed(2),
  }
}

export async function draftRun(body: { year: number; month: number }, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.depreciationRun.findUnique({
      where: { year_month: { year: body.year, month: body.month } },
      select: { id: true, runNo: true, status: true },
    })
    if (existing) {
      throw new AppError(
        409,
        `${monthLabel(body.year, body.month)} already has a depreciation run (${existing.runNo}, ${existing.status.toLowerCase()}). Reversing it frees the month.`,
        { runId: existing.id }
      )
    }

    const fy = await fyForMonth(tx, body.year, body.month)
    if (!fy) {
      throw new AppError(
        409,
        `No financial year covers ${monthLabel(body.year, body.month)}. Create one first.`
      )
    }
    const fyStartMonth = fy.startDate.getUTCMonth() + 1

    const [rules, assets] = await Promise.all([
      loadRules(tx, "ASSET_ACQUISITION"),
      tx.asset.findMany({
        where: { capitalisedAt: { not: null } },
        select: {
          id: true, assetTag: true, name: true, purchaseDate: true, purchaseCostBdt: true,
          capitalisedAt: true, retiredAt: true,
          department: { select: { costNature: true } },
          category: { select: { code: true, isConsumable: true } },
        },
      }),
    ])

    // Consumables were expensed, not capitalised — they have no book value to
    // reduce, so they are excluded before the rate check.
    const capitalised = assets.filter((a) => !a.category.isConsumable)

    // The class account per asset, and the chart rate per class. A class with
    // no rate refuses the whole run, naming the account (Decision 6 rule 4).
    const classCodes = [...new Set(capitalised.map((a) => resolveAccountCode(rules, a.category.code)))]
    const chart = await tx.account.findMany({
      where: { code: { in: classCodes } },
      select: { code: true, depreciationRate: true },
    })
    const rateByCode = new Map(chart.map((c) => [c.code, c.depreciationRate]))

    for (const code of classCodes) {
      if (!rateByCode.get(code)) {
        throw new AppError(409, `${code} has no depreciation rate. Choose one before drafting a run — depreciation will not file a nil charge.`, { accountCode: code })
      }
    }

    const depreciables: DepreciableAsset[] = capitalised.flatMap((a) => {
      if (a.purchaseCostBdt === null || a.purchaseDate === null || !a.capitalisedAt) return []
      const classAccountCode = resolveAccountCode(rules, a.category.code)
      const rate = rateByCode.get(classAccountCode)
      if (!rate) return []
      return [{
        id: a.id,
        assetTag: a.assetTag,
        purchaseDate: a.purchaseDate,
        purchaseCostBdt: a.purchaseCostBdt,
        capitalisedAt: a.capitalisedAt,
        rate,
        classAccountCode,
        costNature: a.department?.costNature ?? "ADMINISTRATIVE",
        stoppedAt: a.retiredAt,
      }]
    })

    const ids = depreciables.map((a) => a.id)
    const priorRows = ids.length
      ? await tx.assetDepreciation.findMany({
          where: { assetId: { in: ids }, run: { status: "POSTED" } },
          select: { assetId: true, run: { select: { year: true, month: true } }, amount: true },
        })
      : []
    const prior = priorRows.map((p) => ({
      assetId: p.assetId,
      year: p.run.year,
      month: p.run.month,
      amount: p.amount,
    }))

    const charges = computeCharges(depreciables, prior, body, fyStartMonth)

    const runNo = await nextRunNo(tx)
    const run = await tx.depreciationRun.create({
      data: { runNo, year: body.year, month: body.month, createdBy: actor.sub },
    })

    await tx.assetDepreciation.createMany({
      data: charges.map((c) => ({
        runId: run.id,
        assetId: c.assetId,
        amount: c.amount,
        openingBookValue: c.openingBookValue,
        rate: c.rate,
        months: c.months,
      })),
    })

    await writeAudit(tx, {
      entity: "DEPRECIATION_RUN",
      entityId: run.id,
      action: "CREATE",
      changedBy: actor.sub,
      after: { runNo, year: body.year, month: body.month, chargeCount: charges.length },
    })

    // Built directly rather than re-queried: the run was created and charged
    // in this transaction, and a second read would return the same rows.
    const assetById = new Map(assets.map((a) => [a.id, a]))
    return {
      id: run.id,
      runNo,
      year: body.year,
      month: body.month,
      status: "DRAFT",
      journalId: null,
      journal: null,
      createdBy: actor.sub,
      createdAt: new Date(),
      postedBy: null,
      postedAt: null,
      reversedBy: null,
      reversedAt: null,
      charges: charges.map((c) => {
        const asset = assetById.get(c.assetId)
        return {
          id: `${run.id}-${c.assetId}`,
          assetId: c.assetId,
          amount: c.amount,
          openingBookValue: c.openingBookValue,
          rate: c.rate,
          months: c.months,
          asset: asset ? { assetTag: asset.assetTag, name: asset.name } : undefined,
        }
      }),
    }
  })
}

export async function getRun(id: string): Promise<DepreciationRunDetail> {
  return prisma.$transaction((tx) => getRunDetail(tx, id))
}

async function getRunDetail(tx: Prisma.TransactionClient, id: string): Promise<DepreciationRunDetail> {
  const run = await tx.depreciationRun.findUnique({
    where: { id },
    include: {
      journal: { select: { journalNo: true } },
      charges: {
        orderBy: { assetId: "asc" },
        include: { asset: { select: { assetTag: true, name: true, category: { select: { name: true } } } } },
      },
    },
  })
  if (!run) throw new AppError(404, "Depreciation run not found")
  const { journal, charges, ...rest } = run
  return {
    ...rest,
    journal,
    charges: charges.map(({ asset, ...c }) => ({
      ...c,
      asset: asset ? { assetTag: asset.assetTag, name: asset.name, categoryName: asset.category.name } : undefined,
    })),
  }
}

export async function listRuns(
  query: { year?: number; status?: DepreciationRunStatus }
): Promise<DepreciationRunSummary[]> {
  const rows = await prisma.depreciationRun.findMany({
    where: {
      ...(query.year ? { year: query.year } : {}),
      ...(query.status ? { status: query.status } : {}),
    },
    include: { charges: { select: { id: true, amount: true } } },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  })
  return rows.map(toSummary)
}

/**
 * THE guarantee: the journal and the state change commit or roll back
 * together, and a closed period refuses before the run leaves DRAFT.
 */
export async function postRun(id: string, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.depreciationRun.findUnique({
      where: { id },
      include: {
        charges: { include: { asset: { select: { assetTag: true, name: true, department: { select: { costNature: true } }, category: { select: { code: true, name: true } } } } } },
      },
    })
    if (!run) throw new AppError(404, "Depreciation run not found")
    if (run.status !== "DRAFT") {
      throw new AppError(409, `${run.runNo} is ${run.status}; only a DRAFT run can be posted. Reverse it to free the month.`)
    }
    if (run.charges.length === 0) {
      throw new AppError(409, `${run.runNo} has no charges to post. Delete the draft instead.`)
    }

    // The class account and cost nature are not stored on the charge — they
    // come from the asset's category and owning department, so recompute them
    // from the live rows, exactly as draftRun did.
    const [rules, acquisitionRules] = await Promise.all([
      loadRules(tx, "ASSET_DEPRECIATION"),
      loadRules(tx, "ASSET_ACQUISITION"),
    ])
    const classCodes = [...new Set(run.charges.map((c) => resolveAccountCode(acquisitionRules, c.asset.category.code)))]
    const chart = await tx.account.findMany({
      where: { code: { in: classCodes } },
      select: { code: true, contraAccountId: true },
    })
    const contraIdByClass = new Map(chart.map((c) => [c.code, c.contraAccountId]))
    for (const code of classCodes) {
      if (!contraIdByClass.get(code)) {
        throw new AppError(409, `Account ${code} has no linked accumulated-depreciation contra.`, { accountCode: code })
      }
    }
    const contraByClass = new Map<string, string>()
    for (const code of classCodes) {
      const contraId = contraIdByClass.get(code)!
      const contra = await tx.account.findUnique({ where: { id: contraId }, select: { code: true } })
      if (!contra) {
        throw new AppError(409, `The contra linked to ${code} no longer exists.`, { accountCode: code })
      }
      contraByClass.set(code, contra.code)
    }

    const charges: ComputedCharge[] = run.charges.map((c) => ({
      assetId: c.assetId,
      amount: c.amount,
      openingBookValue: c.openingBookValue,
      rate: c.rate,
      months: c.months,
      classAccountCode: resolveAccountCode(acquisitionRules, c.asset.category.code),
      costNature: c.asset.department?.costNature ?? "ADMINISTRATIVE",
    }))

    // The period check lives here, before the posting: `postSystemJournal`
    // resolves it too, but refusing before assembling anything is what the
    // preflight and the closed-period guarantee promise.
    const journalDate = toLedgerDate(monthEnd(run.year, run.month))
    await resolveOpenPeriod(tx, journalDate)

    const journal = await postSystemJournal(tx, {
      date: journalDate,
      narration: `Depreciation for ${monthLabel(run.year, run.month)}`,
      source: { module: "DEPRECIATION", refId: run.id, event: "POST" },
      lines: buildDepreciationLines(charges, contraByClass, rules),
      createdBy: actor.sub,
    })

    const updated = await tx.depreciationRun.update({
      where: { id },
      data: { status: "POSTED", journalId: journal.id, postedBy: actor.sub, postedAt: new Date() },
    })

    await writeAudit(tx, {
      entity: "DEPRECIATION_RUN",
      entityId: id,
      action: "POST",
      changedBy: actor.sub,
      before: { status: "DRAFT" },
      after: { status: "POSTED", journalNo: journal.journalNo },
    })

    return getRunDetail(tx, id)
  })
}

/**
 * Reversing a run reverses its journal and frees the (year, month) slot for a
 * re-run. The reversal is a new journal following the accounting module's
 * reversal shape (inverted lines, DRAFT, linked by `reversesId`), and the
 * original is marked REVERSED in the same transaction.
 */
export async function reverseRun(id: string, body: { reason: string }, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    if (!body.reason?.trim()) {
      throw new AppError(400, "Give a reason for the reversal")
    }

    const run = await tx.depreciationRun.findUnique({ where: { id } })
    if (!run) throw new AppError(404, "Depreciation run not found")
    if (run.status !== "POSTED" || !run.journalId) {
      throw new AppError(409, `${run.runNo} is ${run.status.toLowerCase()}; only a POSTED run with a journal can be reversed.`)
    }

    const reversal = await draftReversal(tx, run.journalId, body.reason, actor.sub)

    await tx.depreciationRun.update({
      where: { id },
      data: { status: "REVERSED", reversedBy: actor.sub, reversedAt: new Date() },
    })

    await writeAudit(tx, {
      entity: "DEPRECIATION_RUN",
      entityId: id,
      action: "REVERSE",
      changedBy: actor.sub,
      before: { status: "POSTED" },
      after: { status: "REVERSED", reversedBy: reversal.journalNo },
      note: body.reason,
    })

    return getRunDetail(tx, id)
  })
}

export async function deleteRun(id: string, actor: AccessTokenPayload): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const run = await tx.depreciationRun.findUnique({ where: { id } })
    if (!run) throw new AppError(404, "Depreciation run not found")
    if (run.status === "POSTED") {
      throw new AppError(409, `${run.runNo} is posted; it cannot be deleted. Reverse it instead.`)
    }
    if (run.status === "REVERSED") {
      throw new AppError(409, `${run.runNo} is already reversed; the month is free to re-run.`)
    }

    await tx.depreciationRun.delete({ where: { id } })

    await writeAudit(tx, {
      entity: "DEPRECIATION_RUN",
      entityId: id,
      action: "DELETE",
      changedBy: actor.sub,
      before: { runNo: run.runNo, year: run.year, month: run.month },
    })
  })
}
