/**
 * Salary structures and exchange rates — the configuration Finance owns
 * before any run can be processed — plus the run lifecycle itself.
 */

import { getMonthlySummary } from "../attendance/attendance.summary"
import { monthRange, requireEmployeeForUser } from "../attendance/attendance.service"
import { officeToday } from "../attendance/attendance.time"
import type { AccessTokenPayload } from "../auth/auth.types"
import prisma from "../../config/prisma"
import type { Currency, PayrollStatus, Prisma } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import { assertMonthNotLocked } from "../../utils/month-lock"
import { emitEvent } from "../event/event.emit"
import { sendPayrollSubmittedEmail } from "../notification/notification.mailer"
import { activeSuperAdminEmails } from "../notification/notification.recipients"
import { sweepClaimsReimbursed } from "../expense/expense.sweep"
import { sweepRecoveriesCollected } from "../asset/asset.sweep"
import { postPayrollAccrual, postPayrollPayment } from "./payroll.posting"
import { periodStatusFor } from "../posting/posting.preflight"
import { monthWindow, toLedgerDate } from "../accounting/accounting.utils"
import { payrollRunEvent, payslipPublishedEvent } from "./payroll.events"
import { computePayslip } from "./payroll.calc"
import { resolveRateOrThrow } from "./payroll.fx"
import { bdtTotal, dec, type Money, REPORTING_CURRENCY, toMoneyString } from "./payroll.money"
import {
  assertProcessable,
  loadPayrollRoster,
  preflight,
  toComponentInputs,
} from "./payroll.preflight"
import type {
  AdjustmentBody,
  AdjustmentQuery,
  CreateRunBody,
  ExchangeRateBody,
  ExchangeRateUpdateBody,
  RejectRunBody,
  SalaryStructureBody,
} from "./payroll.validators"

function isUniqueViolation(err: unknown): boolean {
  return (err as Prisma.PrismaClientKnownRequestError)?.code === "P2002"
}

const asUtcMidnight = (dateOnly: string) => new Date(`${dateOnly}T00:00:00.000Z`)

function rateConflict(base: string, quote: string, effectiveFrom: string): AppError {
  return new AppError(
    409,
    `A ${base}→${quote} rate already exists effective ${effectiveFrom}`
  )
}

function serializeRate(rate: { base: string; quote: string; rate: Prisma.Decimal; effectiveFrom: Date }) {
  return {
    base: rate.base,
    quote: rate.quote,
    // 6dp, matching the column's own precision — a rate is a ratio, not
    // money, so toMoneyString's 2dp would round 122.456789 to 122.46.
    rate: rate.rate.toFixed(6),
    effectiveFrom: rate.effectiveFrom.toISOString().slice(0, 10),
  }
}

export async function listExchangeRates() {
  return prisma.exchangeRate.findMany({
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  })
}

export async function createExchangeRate(actorUserId: string, body: ExchangeRateBody) {
  try {
    return await prisma.$transaction(async (tx) => {
      const rate = await tx.exchangeRate.create({
        data: {
          base: body.base,
          quote: body.quote,
          rate: dec(body.rate),
          effectiveFrom: asUtcMidnight(body.effectiveFrom),
          createdBy: actorUserId,
        },
      })
      await writeAudit(tx, {
        entity: "EXCHANGE_RATE",
        entityId: rate.id,
        action: "CREATE",
        changedBy: actorUserId,
        after: serializeRate(rate),
      })
      return rate
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw rateConflict(body.base, body.quote, body.effectiveFrom)
    throw err
  }
}

/**
 * Editing a rate row is allowed and audited, and it cannot corrupt history:
 * every payslip and settlement freezes the rate value it used, not a
 * reference to this row.
 */
export async function updateExchangeRate(
  id: string,
  actorUserId: string,
  body: ExchangeRateUpdateBody
) {
  const existing = await prisma.exchangeRate.findUnique({ where: { id } })
  if (!existing) throw new AppError(404, "Exchange rate not found")

  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.exchangeRate.update({
        where: { id },
        data: {
          base: body.base,
          quote: body.quote,
          rate: dec(body.rate),
          effectiveFrom: asUtcMidnight(body.effectiveFrom),
        },
      })
      await writeAudit(tx, {
        entity: "EXCHANGE_RATE",
        entityId: id,
        action: "UPDATE",
        changedBy: actorUserId,
        before: serializeRate(existing),
        after: serializeRate(updated),
      })
      return updated
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw rateConflict(body.base, body.quote, body.effectiveFrom)
    throw err
  }
}

type StructureWithComponents = Prisma.SalaryStructureGetPayload<{ include: { components: true } }>

function serializeStructure(structure: StructureWithComponents) {
  return {
    name: structure.name,
    currency: structure.currency,
    basic: toMoneyString(structure.basic),
    isActive: structure.isActive,
    components: structure.components.map((c) => ({
      code: c.code,
      label: c.label,
      kind: c.kind,
      calc: c.calc,
      value: c.value.toFixed(2),
      sortOrder: c.sortOrder,
      countsAsWages: c.countsAsWages,
    })),
  }
}

function structureConflict(name: string): AppError {
  return new AppError(409, `A salary structure named "${name}" already exists`)
}

const toComponentCreateInput = (c: SalaryStructureBody["components"][number]) => ({
  code: c.code,
  label: c.label,
  kind: c.kind,
  calc: c.calc,
  value: dec(c.value),
  sortOrder: c.sortOrder,
  countsAsWages: c.countsAsWages,
})

/**
 * Every structure, with how many people are on it.
 *
 * The count is what makes the delete control honest. `deleteSalaryStructure`
 * refuses a structure in use, so without it the only way to learn that is to
 * press Delete and read the refusal — a button whose whole purpose is to be
 * pressed and then not work.
 *
 * Flattened out of Prisma's `_count` here rather than in the client: `_count`
 * is an ORM artefact, and a response shape should not leak which ORM produced
 * it.
 */
export async function listSalaryStructures() {
  const rows = await prisma.salaryStructure.findMany({
    include: {
      components: { orderBy: [{ sortOrder: "asc" }, { code: "asc" }] },
      _count: { select: { employees: true } },
    },
    orderBy: { name: "asc" },
  })

  return rows.map(({ _count, ...structure }) => ({
    ...structure,
    employeeCount: _count.employees,
  }))
}

export async function createSalaryStructure(actorUserId: string, body: SalaryStructureBody) {
  try {
    return await prisma.$transaction(async (tx) => {
      const structure = await tx.salaryStructure.create({
        data: {
          name: body.name,
          currency: body.currency,
          basic: dec(body.basic),
          isActive: body.isActive,
          components: { create: body.components.map(toComponentCreateInput) },
        },
        include: { components: true },
      })
      await writeAudit(tx, {
        entity: "SALARY_STRUCTURE",
        entityId: structure.id,
        action: "CREATE",
        changedBy: actorUserId,
        after: serializeStructure(structure),
      })
      return structure
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw structureConflict(body.name)
    throw err
  }
}

export async function updateSalaryStructure(
  id: string,
  actorUserId: string,
  body: SalaryStructureBody
) {
  const existing = await prisma.salaryStructure.findUnique({
    where: { id },
    include: { components: true },
  })
  if (!existing) throw new AppError(404, "Salary structure not found")

  // Immutable after creation — changing it silently re-denominates every
  // figure already resolved against this structure.
  if (body.currency !== existing.currency) {
    throw new AppError(
      409,
      "Cannot change a salary structure's currency. Every FIXED component and every payslip that used it is denominated in the original currency — move affected employees to a different structure instead."
    )
  }

  if (body.isActive === false) {
    const assigned = await prisma.employee.count({ where: { salaryStructureId: id } })
    if (assigned > 0) {
      throw new AppError(
        409,
        `${assigned} employee(s) are still assigned to this structure. Reassign them before retiring it.`
      )
    }
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // A wholesale replace, not a diff: nothing else in the schema holds a
      // foreign key to SalaryComponent, so delete-then-recreate cannot orphan
      // anything, and it is simpler than reconciling adds/edits/removals by
      // code.
      await tx.salaryComponent.deleteMany({ where: { salaryStructureId: id } })
      const structure = await tx.salaryStructure.update({
        where: { id },
        data: {
          name: body.name,
          basic: dec(body.basic),
          isActive: body.isActive,
          components: { create: body.components.map(toComponentCreateInput) },
        },
        include: { components: true },
      })
      await writeAudit(tx, {
        entity: "SALARY_STRUCTURE",
        entityId: id,
        action: "UPDATE",
        changedBy: actorUserId,
        before: serializeStructure(existing),
        after: serializeStructure(structure),
      })
      return structure
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw structureConflict(body.name)
    throw err
  }
}

/**
 * Deletes a salary structure outright.
 *
 * Safe for history, and that is not an accident: a payslip is a frozen
 * snapshot holding its own basic, its own lines and its own totals — nothing
 * in the schema points a payslip at a `SalaryStructure`. So a June payslip
 * stays fully explicable after the structure it was computed from is gone.
 * The only rows that reference one are `SalaryComponent` (cascades) and
 * `Employee` (guarded below).
 *
 * The guard is the assignment count, not payslip usage. Prisma's default for
 * an optional relation is `SetNull`, so deleting a structure with people on
 * it would silently un-assign them and surface a month later as preflight
 * blocker 3. Refusing is the only honest option.
 */
export async function deleteSalaryStructure(id: string, actorUserId: string) {
  const existing = await prisma.salaryStructure.findUnique({
    where: { id },
    include: { components: true },
  })
  if (!existing) throw new AppError(404, "Salary structure not found")

  const assigned = await prisma.employee.count({ where: { salaryStructureId: id } })
  if (assigned > 0) {
    throw new AppError(
      409,
      `${assigned} employee(s) are still on this structure. Move them to another one before deleting it.`,
      { assigned }
    )
  }

  return prisma.$transaction(async (tx) => {
    // Explicit rather than leaning on the cascade: the delete and its audit
    // row belong in one transaction, and being able to read the components
    // back out of `before` is the point of writing it.
    await tx.salaryComponent.deleteMany({ where: { salaryStructureId: id } })
    await tx.salaryStructure.delete({ where: { id } })
    await writeAudit(tx, {
      entity: "SALARY_STRUCTURE",
      entityId: id,
      action: "DELETE",
      changedBy: actorUserId,
      // The whole structure, so a deleted band is still reconstructable from
      // the log — an audit row naming only an id explains nothing.
      before: serializeStructure(existing),
    })
    return { id }
  })
}

// ── Run lifecycle ────────────────────────────────────────────────────────

/**
 * Not a real user — see `payroll.preflight.ts`'s `SYSTEM_ACTOR` for why a
 * synthetic Finance-role actor stands in for one when a background
 * operation needs the whole-company attendance roster.
 */
const SYSTEM_ACTOR = {
  sub: "system",
  role: "FINANCE_OFFICER" as const,
  email: "system@payroll.internal",
  mustChangePassword: false,
  salesRole: null,
}

const monthLabel = (month: number, year: number) => `${year}-${String(month).padStart(2, "0")}`

function runConflict(month: number, year: number): AppError {
  return new AppError(409, `A payroll run for ${monthLabel(month, year)} already exists`)
}

export async function listRuns() {
  const runs = await prisma.payrollRun.findMany({ orderBy: [{ year: "desc" }, { month: "desc" }] })
  const totals = await prisma.payslip.groupBy({
    by: ["payrollRunId"],
    _sum: { grossPayBdt: true, totalDeductionsBdt: true, netPayBdt: true, netPayableBdt: true },
    _count: { _all: true },
  })
  const totalsByRun = new Map(totals.map((t) => [t.payrollRunId, t]))

  return runs.map((run) => {
    const t = totalsByRun.get(run.id)
    return {
      ...run,
      payslipCount: t?._count._all ?? 0,
      grossPayBdt: t?._sum.grossPayBdt ?? dec(0),
      totalDeductionsBdt: t?._sum.totalDeductionsBdt ?? dec(0),
      netPayBdt: t?._sum.netPayBdt ?? dec(0),
      netPayableBdt: t?._sum.netPayableBdt ?? dec(0),
    }
  })
}

export async function getRun(id: string) {
  const run = await prisma.payrollRun.findUnique({
    where: { id },
    include: {
      payslips: {
        include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
        orderBy: { employee: { fullName: "asc" } },
      },
    },
  })
  if (!run) throw new AppError(404, "Payroll run not found")
  return { ...run, preflight: await preflight(run.month, run.year) }
}

export async function getRunPreflight(id: string) {
  const run = await prisma.payrollRun.findUnique({ where: { id }, select: { month: true, year: true } })
  if (!run) throw new AppError(404, "Payroll run not found")
  const base = await preflight(run.month, run.year)
  const [accrual, payment] = await Promise.all([
    periodStatusFor(prisma, monthWindow(run.year, run.month).endDate),
    periodStatusFor(prisma, toLedgerDate(new Date())),
  ])
  return { ...base, accounting: { accrual, payment } }
}

export async function createRun(actorUserId: string, body: CreateRunBody) {
  // A month that has not started yet has no attendance to process — this is
  // distinct from the current, still-in-progress month, which a run may be
  // drafted for early even though preflight will block processing it until
  // it ends.
  const requestedStart = new Date(Date.UTC(body.year, body.month - 1, 1))
  if (requestedStart.getTime() > officeToday().getTime()) {
    throw new AppError(400, `${monthLabel(body.month, body.year)} has not started yet`)
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.create({
        data: { month: body.month, year: body.year, notes: body.notes },
      })
      await writeAudit(tx, {
        entity: "PAYROLL_RUN",
        entityId: run.id,
        action: "CREATE",
        changedBy: actorUserId,
        after: { month: run.month, year: run.year, notes: run.notes },
      })
      await emitEvent(
        tx,
        payrollRunEvent({
          stage: "created",
          runId: run.id,
          month: run.month,
          year: run.year,
          actorUserId,
        })
      )
      return run
    })
  } catch (err) {
    // The most important guard in this module: two runs for one month is a
    // double payment, not a data-quality problem.
    if (isUniqueViolation(err)) throw runConflict(body.month, body.year)
    throw err
  }
}

function requireStatus(run: { status: string }, status: string, action: string): void {
  if (run.status !== status) {
    throw new AppError(
      409,
      `Cannot ${action} a run that is ${run.status.toLowerCase()} — this action is only legal from ${status}`
    )
  }
}

/**
 * BDT per one unit of `currency`, converting an adjustment between two
 * currencies. Both are BDT or USD — the only pair this system has.
 */
function convertBetween(amount: Money, from: Currency, to: Currency, usdToBdt: Money | null): Money {
  if (from === to) return amount
  if (!usdToBdt) {
    throw new Error(
      `Cannot convert ${from} to ${to} without a resolved USD rate — preflight should have blocked this`
    )
  }
  return from === REPORTING_CURRENCY ? amount.dividedBy(usdToBdt) : amount.times(usdToBdt)
}

/**
 * Idempotent: deletes the run's payslips, releases every adjustment and
 * claim that pointed at them, and recomputes from scratch. Reprocessing is a
 * normal act — HR adds a missing bonus, a manager finally approves a stuck
 * record, someone fixes a rate. A clean rebuild is what stops a
 * half-processed run existing; restricting it to DRAFT is what stops an
 * approved run being rewritten under the approver.
 */
export async function processRun(id: string, actorUserId: string) {
  const run = await prisma.payrollRun.findUnique({ where: { id } })
  if (!run) throw new AppError(404, "Payroll run not found")
  requireStatus(run, "DRAFT", "process")

  return prisma.$transaction(async (tx) => {
    // First, so a run that cannot legally be paid is never partially
    // rewritten. Read via the plain client rather than `tx` — the same
    // read-then-write pattern `assertMonthNotLocked` already uses elsewhere
    // in this codebase — because these are sanity reads with nothing to roll
    // back if they pass; only the writes below need the transaction.
    await assertProcessable(run.month, run.year)

    const roster = (await loadPayrollRoster(run.month, run.year)).filter(
      (e): e is typeof e & { salaryStructure: NonNullable<(typeof e)["salaryStructure"]> } =>
        e.salaryStructure !== null
    )
    const rosterIds = roster.map((e) => e.id)
    const { to: monthEnd } = monthRange(run.year, run.month)

    // Resolve the run's rate once. USD is the only non-BDT currency this
    // system has, so "the rate per currency" collapses to "the USD rate" —
    // null when nobody in the roster is paid in it, since there is then no
    // "the rate" to speak of.
    const needsUsd = roster.some((e) => e.salaryStructure.currency !== REPORTING_CURRENCY)
    const usdRate = needsUsd ? await resolveRateOrThrow("USD", monthEnd) : null

    // Deleting the payslip rows is enough to release every PayrollAdjustment
    // and ExpenseClaim that pointed at them — both foreign keys are
    // ON DELETE SET NULL precisely so a reprocess does not have to remember
    // to clear them by hand.
    await tx.payslip.deleteMany({ where: { payrollRunId: id } })

    const summaries = await getMonthlySummary(SYSTEM_ACTOR, run.month, run.year)
    const summaryByEmployee = new Map(summaries.map((s) => [s.employee.id, s]))

    const unclaimedAdjustments =
      rosterIds.length === 0
        ? []
        : await tx.payrollAdjustment.findMany({
            where: { employeeId: { in: rosterIds }, month: run.month, year: run.year, payslipId: null },
          })
    // Only APPROVED claims with both payslipId and settlementId null, and
    // only for employees in this run. A claim already on a settlement must
    // never also be swept onto a payslip.
    const unsweptClaims =
      rosterIds.length === 0
        ? []
        : await tx.expenseClaim.findMany({
            where: {
              employeeId: { in: rosterIds },
              status: "APPROVED",
              payslipId: null,
              settlementId: null,
            },
          })
    const claimsByEmployee = new Map<string, typeof unsweptClaims>()
    for (const claim of unsweptClaims) {
      const list = claimsByEmployee.get(claim.employeeId) ?? []
      list.push(claim)
      claimsByEmployee.set(claim.employeeId, list)
    }

    const adjustmentsByEmployee = new Map<string, typeof unclaimedAdjustments>()
    for (const adjustment of unclaimedAdjustments) {
      const list = adjustmentsByEmployee.get(adjustment.employeeId) ?? []
      list.push(adjustment)
      adjustmentsByEmployee.set(adjustment.employeeId, list)
    }

    const calendarDays = new Date(Date.UTC(run.year, run.month, 0)).getUTCDate()

    for (const employee of roster) {
      const structure = employee.salaryStructure
      const summary = summaryByEmployee.get(employee.id)
      // Invariant, not user input: loadPayrollRoster's population is always
      // a subset of getMonthlySummary's (same ACTIVE/ON_LEAVE filter, plus a
      // joining-date restriction), so every roster member has a summary.
      if (!summary) {
        throw new Error(`No attendance summary for roster employee ${employee.id} — this is a bug`)
      }

      const rate = structure.currency === REPORTING_CURRENCY ? dec(1) : usdRate!
      const adjustments = (adjustmentsByEmployee.get(employee.id) ?? []).map((a) => ({
        code: a.code,
        label: a.label,
        kind: a.kind,
        amount: convertBetween(dec(a.amount), a.currency, structure.currency, usdRate),
      }))

      // Each claim was already converted once, at approval, at its own
      // spend-date rate. Its BDT value is therefore fixed; only the final
      // hop into this payslip's currency remains.
      const employeeClaims = claimsByEmployee.get(employee.id) ?? []
      const reimbursements = employeeClaims.map((claim) => {
        const claimRate = claim.fxRateToBdt ?? dec(1)
        const amountInBdt = dec(claim.amount).times(claimRate)
        return {
          claimId: claim.id,
          category: claim.categoryId,
          expenseDate: claim.expenseDate.toISOString().slice(0, 10),
          spentCurrency: claim.currency,
          spentAmount: dec(claim.amount),
          fxRateToBdt: claimRate,
          amount:
            structure.currency === REPORTING_CURRENCY ? amountInBdt : amountInBdt.dividedBy(usdRate!),
        }
      })

      const result = computePayslip({
        basic: dec(structure.basic),
        components: toComponentInputs(structure.components),
        adjustments,
        reimbursements,
        calendarDays,
        workingDays: summary.workingDays,
        present: summary.present,
        absent: summary.absent,
        onPaidLeave: summary.onPaidLeave,
        onUnpaidLeave: summary.onUnpaidLeave,
      })

      const counter = await tx.idCounter.upsert({
        where: { id: "PAY" },
        update: { value: { increment: 1 } },
        create: { id: "PAY", value: 1 },
      })
      const payslipNo = `BS-PAY-${String(counter.value).padStart(6, "0")}`

      const payslip = await tx.payslip.create({
        data: {
          payslipNo,
          payrollRunId: id,
          employeeId: employee.id,
          calendarDays: result.calendarDays,
          lopDays: result.lopDays,
          payableDays: result.payableDays,
          currency: structure.currency,
          basic: result.basic,
          grossFull: result.grossFull,
          grossPay: result.grossPay,
          totalDeductions: result.totalDeductions,
          netPay: result.netPay,
          reimbursements: result.reimbursements,
          netPayable: result.netPayable,
          fxRateToBdt: rate,
          grossPayBdt: bdtTotal(result.grossPay, rate),
          totalDeductionsBdt: bdtTotal(result.totalDeductions, rate),
          netPayBdt: bdtTotal(result.netPay, rate),
          netPayableBdt: bdtTotal(result.netPayable, rate),
          breakdown: {
            currency: structure.currency,
            fxRateToBdt: rate.toFixed(6),
            ...result.breakdown,
          } as unknown as Prisma.InputJsonValue,
        },
      })

      const consumedIds = (adjustmentsByEmployee.get(employee.id) ?? []).map((a) => a.id)
      if (consumedIds.length > 0) {
        await tx.payrollAdjustment.updateMany({
          where: { id: { in: consumedIds } },
          data: { payslipId: payslip.id },
        })
      }
      if (employeeClaims.length > 0) {
        await tx.expenseClaim.updateMany({
          where: { id: { in: employeeClaims.map((c) => c.id) } },
          data: { payslipId: payslip.id },
        })
      }
    }

    const updated = await tx.payrollRun.update({
      where: { id },
      data: { fxRateToBdt: usdRate, processedBy: actorUserId, processedAt: new Date() },
    })
    await writeAudit(tx, {
      entity: "PAYROLL_RUN",
      entityId: id,
      action: "PROCESS",
      changedBy: actorUserId,
      after: { payslipCount: roster.length, fxRateToBdt: usdRate?.toFixed(6) ?? null },
    })
    await emitEvent(
      tx,
      payrollRunEvent({
        stage: "processed",
        runId: id,
        month: run.month,
        year: run.year,
        actorUserId,
        // A count, not a total. How many payslips is operationally useful;
        // what they add up to is not a dashboard number.
        meta: `${roster.length} payslip${roster.length === 1 ? "" : "s"}`,
      })
    )

    return updated
  })
}

export async function submitRun(id: string, actorUserId: string) {
  const run = await prisma.payrollRun.findUnique({ where: { id } })
  if (!run) throw new AppError(404, "Payroll run not found")
  requireStatus(run, "DRAFT", "submit")
  if (!run.processedAt) {
    throw new AppError(409, "This run has not been processed yet — process it before submitting")
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.payrollRun.update({
      where: { id },
      data: { status: "SUBMITTED", submittedBy: actorUserId, submittedAt: new Date() },
    })
    await writeAudit(tx, {
      entity: "PAYROLL_RUN",
      entityId: id,
      action: "SUBMIT",
      changedBy: actorUserId,
    })
    await emitEvent(
      tx,
      payrollRunEvent({
        stage: "submitted",
        runId: id,
        month: run.month,
        year: run.year,
        actorUserId,
      })
    )
    return row
  })

  // After the transaction, and to every active Super Admin rather than one:
  // any of them can approve, and picking one makes payday wait on whoever is
  // away. The totals are read in BDT, the one currency every payslip is
  // normalised to, so a mixed-currency run still adds up.
  const [recipients, totals] = await Promise.all([
    activeSuperAdminEmails(),
    prisma.payslip.aggregate({
      where: { payrollRunId: id },
      _sum: { netPayableBdt: true },
      _count: { _all: true },
    }),
  ])
  await Promise.all(
    recipients.map((to) =>
      sendPayrollSubmittedEmail({
        to,
        runId: id,
        month: run.month,
        year: run.year,
        employeeCount: totals._count._all,
        totalNet: toMoneyString(totals._sum.netPayableBdt ?? dec(0)),
        currency: "BDT",
      })
    )
  )

  return updated
}

/**
 * The approver's user id must differ from `submittedBy` — the same rule as
 * settlement's calculator/approver split. A one-person deployment holding
 * both roles cannot approve its own run; that is the control working, not a
 * bug.
 */
export async function approveRun(id: string, actorUserId: string) {
  const run = await prisma.payrollRun.findUnique({ where: { id } })
  if (!run) throw new AppError(404, "Payroll run not found")
  requireStatus(run, "SUBMITTED", "approve")
  if (run.submittedBy === actorUserId) {
    throw new AppError(403, "You submitted this run and cannot also approve it")
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.payrollRun.update({
      where: { id },
      data: { status: "APPROVED", approvedBy: actorUserId, approvedAt: new Date() },
    })
    await postPayrollAccrual(tx, id, actorUserId)
    await writeAudit(tx, {
      entity: "PAYROLL_RUN",
      entityId: id,
      action: "APPROVE",
      changedBy: actorUserId,
    })
    await emitEvent(
      tx,
      payrollRunEvent({
        stage: "approved",
        runId: id,
        month: run.month,
        year: run.year,
        actorUserId,
      })
    )

    // Approval is the moment a payslip becomes visible to the person it
    // belongs to — `visibleRunFilter` admits APPROVED and DISBURSED — so it
    // is the moment to say so, and there is no earlier one.
    const payslips = await tx.payslip.findMany({
      where: { payrollRunId: id },
      select: { id: true, employeeId: true },
    })
    for (const payslip of payslips) {
      await emitEvent(
        tx,
        payslipPublishedEvent({
          payslipId: payslip.id,
          employeeId: payslip.employeeId,
          month: run.month,
          year: run.year,
          actorUserId,
        })
      )
    }
    return updated
  })
}

/**
 * Returns to DRAFT, not a terminal REJECTED — the month still has to be
 * paid, and process is an idempotent rebuild precisely so the cause can be
 * fixed and the run resubmitted.
 */
export async function rejectRun(id: string, actorUserId: string, body: RejectRunBody) {
  const run = await prisma.payrollRun.findUnique({ where: { id } })
  if (!run) throw new AppError(404, "Payroll run not found")
  requireStatus(run, "SUBMITTED", "reject")

  return prisma.$transaction(async (tx) => {
    const updated = await tx.payrollRun.update({
      where: { id },
      data: { status: "DRAFT", rejectionNote: body.note },
    })
    await writeAudit(tx, {
      entity: "PAYROLL_RUN",
      entityId: id,
      action: "REJECT",
      changedBy: actorUserId,
      note: body.note,
    })
    await emitEvent(
      tx,
      payrollRunEvent({
        stage: "rejected",
        runId: id,
        month: run.month,
        year: run.year,
        actorUserId,
        meta: body.note,
      })
    )
    return updated
  })
}

/** Terminal — there is no un-disburse. */
export async function disburseRun(id: string, actorUserId: string) {
  const run = await prisma.payrollRun.findUnique({ where: { id } })
  if (!run) throw new AppError(404, "Payroll run not found")
  requireStatus(run, "APPROVED", "disburse")

  // Reported, not posted — there is no ledger for an FX gain or loss to go
  // to. Only meaningful when the run actually used a foreign rate.
  const disbursementFxRateToBdt = run.fxRateToBdt
    ? await resolveRateOrThrow("USD", officeToday())
    : null

  return prisma.$transaction(async (tx) => {
    const updated = await tx.payrollRun.update({
      where: { id },
      data: {
        status: "DISBURSED",
        disbursedBy: actorUserId,
        disbursedAt: new Date(),
        disbursementFxRateToBdt,
      },
    })
    // A no-op until Task 11 introduces approved, unswept claims — the update
    // targets exactly the claims this run's own payslips consumed.
    await sweepClaimsReimbursed(
      tx,
      { payslip: { payrollRunId: id }, status: "APPROVED" },
      actorUserId
    )
    // The recoveries this run collected through its adjustments: the sweep
    // flips status only, matching the money that just moved.
    await sweepRecoveriesCollected(
      tx,
      { status: "PENDING", adjustment: { payslip: { payrollRunId: id } } },
      actorUserId
    )
    await postPayrollPayment(tx, id, actorUserId)
    await writeAudit(tx, {
      entity: "PAYROLL_RUN",
      entityId: id,
      action: "DISBURSE",
      changedBy: actorUserId,
      after: { disbursementFxRateToBdt: disbursementFxRateToBdt?.toFixed(6) ?? null },
    })
    await emitEvent(
      tx,
      payrollRunEvent({
        stage: "disbursed",
        runId: id,
        month: run.month,
        year: run.year,
        actorUserId,
      })
    )
    return updated
  })
}

// ── Payslip reads ────────────────────────────────────────────────────────

const PAYSLIP_INCLUDE = {
  employee: { select: { id: true, fullName: true, employeeCode: true } },
  payrollRun: { select: { id: true, month: true, year: true, status: true } },
} as const

/** Roles that administer payroll and may therefore see draft figures. */
const PAYROLL_ADMIN_ROLES = ["HR_ADMIN", "FINANCE_OFFICER", "SUPER_ADMIN"]

/**
 * Staff see a payslip only once its run is APPROVED or DISBURSED. Showing
 * someone a draft figure that then changes is a conversation nobody wants;
 * HR/Finance/Super Admin see drafts because working the draft is their job.
 */
const visibleRunFilter = (actor: AccessTokenPayload) =>
  PAYROLL_ADMIN_ROLES.includes(actor.role)
    ? {}
    : { payrollRun: { status: { in: ["APPROVED", "DISBURSED"] satisfies PayrollStatus[] } } }

export async function getMyPayslips(actor: AccessTokenPayload) {
  const self = await requireEmployeeForUser(actor.sub)
  return prisma.payslip.findMany({
    where: { employeeId: self.id, ...visibleRunFilter(actor) },
    include: PAYSLIP_INCLUDE,
    orderBy: [{ payrollRun: { year: "desc" } }, { payrollRun: { month: "desc" } }],
  })
}

/**
 * Scoping: EMPLOYEE and REPORTING_MANAGER may read only themselves.
 *
 * A manager cannot see their reports' payslips, diverging from the rule leave
 * and attendance share. The source spec's permission matrix gives managers no
 * payroll access, and pay is the one place where line-manager visibility is a
 * policy choice rather than an operational need.
 */
export async function getEmployeePayslips(actor: AccessTokenPayload, employeeId: string) {
  if (!PAYROLL_ADMIN_ROLES.includes(actor.role)) {
    const self = await requireEmployeeForUser(actor.sub)
    if (self.id !== employeeId) {
      throw new AppError(403, "You may only view your own payslips")
    }
  }
  return prisma.payslip.findMany({
    where: { employeeId, ...visibleRunFilter(actor) },
    include: PAYSLIP_INCLUDE,
    orderBy: [{ payrollRun: { year: "desc" } }, { payrollRun: { month: "desc" } }],
  })
}

export async function getPayslip(actor: AccessTokenPayload, id: string) {
  const payslip = await prisma.payslip.findUnique({ where: { id }, include: PAYSLIP_INCLUDE })
  if (!payslip) throw new AppError(404, "Payslip not found")

  if (!PAYROLL_ADMIN_ROLES.includes(actor.role)) {
    const self = await requireEmployeeForUser(actor.sub)
    if (payslip.employeeId !== self.id) {
      throw new AppError(403, "You may only view your own payslips")
    }
    // 404 rather than 403 for a draft: the employee is entitled to this
    // payslip, it simply does not exist as far as they are concerned yet.
    if (payslip.payrollRun.status !== "APPROVED" && payslip.payrollRun.status !== "DISBURSED") {
      throw new AppError(404, "Payslip not found")
    }
  }
  return payslip
}

// ── Adjustments ──────────────────────────────────────────────────────────

export async function listAdjustments(query: AdjustmentQuery) {
  return prisma.payrollAdjustment.findMany({
    where: {
      month: query.month,
      year: query.year,
      employeeId: query.employeeId,
    },
    include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
    orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }],
  })
}

export async function createAdjustment(actorUserId: string, body: AdjustmentBody) {
  const employee = await prisma.employee.findUnique({ where: { id: body.employeeId } })
  if (!employee) throw new AppError(404, "Employee not found")

  // An adjustment changes what a month should pay, so it is illegal once
  // that month's payroll is approved or disbursed.
  await assertMonthNotLocked(new Date(Date.UTC(body.year, body.month - 1, 1)))

  return prisma.$transaction(async (tx) => {
    const adjustment = await tx.payrollAdjustment.create({
      data: {
        employeeId: body.employeeId,
        month: body.month,
        year: body.year,
        kind: body.kind,
        code: body.code,
        label: body.label,
        currency: body.currency,
        amount: dec(body.amount),
        reason: body.reason,
        createdBy: actorUserId,
      },
    })
    await writeAudit(tx, {
      entity: "ADJUSTMENT",
      entityId: adjustment.id,
      action: "CREATE",
      changedBy: actorUserId,
      after: {
        employeeId: adjustment.employeeId,
        month: adjustment.month,
        year: adjustment.year,
        kind: adjustment.kind,
        code: adjustment.code,
        currency: adjustment.currency,
        amount: toMoneyString(adjustment.amount),
      },
      note: adjustment.reason,
    })
    return adjustment
  })
}

export async function deleteAdjustment(id: string, actorUserId: string) {
  const existing = await prisma.payrollAdjustment.findUnique({ where: { id } })
  if (!existing) throw new AppError(404, "Adjustment not found")

  // Reprocess the run to release it first, rather than silently orphaning a
  // line that has already been paid.
  if (existing.payslipId) {
    throw new AppError(
      409,
      "This adjustment has already been paid on a payslip. Reprocess the run to release it before deleting."
    )
  }

  await assertMonthNotLocked(new Date(Date.UTC(existing.year, existing.month - 1, 1)))

  return prisma.$transaction(async (tx) => {
    await tx.payrollAdjustment.delete({ where: { id } })
    await writeAudit(tx, {
      entity: "ADJUSTMENT",
      entityId: id,
      action: "DELETE",
      changedBy: actorUserId,
      before: {
        employeeId: existing.employeeId,
        month: existing.month,
        year: existing.year,
        code: existing.code,
        amount: toMoneyString(existing.amount),
      },
    })
    return { id }
  })
}
