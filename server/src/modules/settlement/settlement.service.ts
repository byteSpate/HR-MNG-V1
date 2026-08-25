/**
 * Full and final settlement: calculate, override, approve, pay.
 *
 * The lifecycle mirrors PayrollRun deliberately — Finance calculates, Super
 * Admin approves and cannot be `calculatedBy`, Finance pays — so it needs no
 * second mental model.
 */

import { getMonthlySummary } from "../attendance/attendance.summary"
import { monthRange } from "../attendance/attendance.service"
import type { AccessTokenPayload } from "../auth/auth.types"
import prisma from "../../config/prisma"
import type { Prisma } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import { emitEvent } from "../event/event.emit"
import { sendSettlementStatementEmail } from "../notification/notification.mailer"
import { sweepClaimsReimbursed } from "../expense/expense.sweep"
import { sweepRecoveriesCollected } from "../asset/asset.sweep"
import { resolveRateOrThrow } from "../payroll/payroll.fx"
import { bdtTotal, dec, type Money, REPORTING_CURRENCY, toMoneyString } from "../payroll/payroll.money"
import { toComponentInputs } from "../payroll/payroll.preflight"
import { postSettlementAccrual, postSettlementPayment } from "./settlement.posting"
import {
  completedServiceYears,
  computeGratuity,
  computeNoticePay,
  computePendingSalary,
  finalAmount,
  serviceYears,
  wagesBase,
} from "./settlement.calc"
import { settlementEvent } from "./settlement.events"
import { EXIT_POLICIES } from "./settlement.policy"
import type { OverrideSettlementBody, SettlementRejectBody } from "./settlement.validators"

const SYSTEM_ACTOR: AccessTokenPayload = {
  sub: "system",
  role: "FINANCE_OFFICER",
  email: "system@payroll.internal",
  mustChangePassword: false,
}

const SETTLEMENT_INCLUDE = {
  employee: {
    select: { id: true, fullName: true, employeeCode: true, joiningDate: true },
  },
  claims: { select: { id: true, category: true, amount: true, currency: true } },
} as const

/**
 * Finance may replace a computed head with a reason while the settlement is
 * DRAFT. A payroll system that silently arbitrated a §23 dispute would be
 * worse than one that shows its working and lets a human overrule it.
 */
export async function overrideSettlement(
  id: string,
  actorUserId: string,
  body: OverrideSettlementBody
) {
  const existing = await prisma.settlement.findUnique({ where: { id } })
  if (!existing) throw new AppError(404, "Settlement not found")
  if (existing.status !== "DRAFT") {
    throw new AppError(409, `This settlement is already ${existing.status.toLowerCase()}`)
  }

  const next = {
    pendingSalary: body.pendingSalary !== undefined ? dec(body.pendingSalary) : existing.pendingSalary,
    gratuity: body.gratuity !== undefined ? dec(body.gratuity) : existing.gratuity,
    noticePay: body.noticePay !== undefined ? dec(body.noticePay) : existing.noticePay,
    expenseReimbursement:
      body.expenseReimbursement !== undefined
        ? dec(body.expenseReimbursement)
        : existing.expenseReimbursement,
    leaveEncashment: existing.leaveEncashment,
    outstandingDeductions:
      body.outstandingDeductions !== undefined
        ? dec(body.outstandingDeductions)
        : existing.outstandingDeductions,
    assetRecoveries:
      body.assetRecoveries !== undefined
        ? dec(body.assetRecoveries)
        : existing.assetRecoveries,
  }
  const total = finalAmount(next)

  return prisma.$transaction(async (tx) => {
    const updated = await tx.settlement.update({
      where: { id },
      data: {
        ...next,
        finalAmount: total,
        finalAmountBdt: bdtTotal(total, existing.fxRateToBdt),
      },
      include: SETTLEMENT_INCLUDE,
    })
    await writeAudit(tx, {
      entity: "SETTLEMENT",
      entityId: id,
      action: "UPDATE",
      changedBy: actorUserId,
      before: {
        pendingSalary: toMoneyString(existing.pendingSalary),
        gratuity: toMoneyString(existing.gratuity),
        noticePay: toMoneyString(existing.noticePay),
        outstandingDeductions: toMoneyString(existing.outstandingDeductions),
        assetRecoveries: toMoneyString(existing.assetRecoveries),
        finalAmount: toMoneyString(existing.finalAmount),
      },
      after: {
        pendingSalary: toMoneyString(next.pendingSalary),
        gratuity: toMoneyString(next.gratuity),
        noticePay: toMoneyString(next.noticePay),
        outstandingDeductions: toMoneyString(next.outstandingDeductions),
        assetRecoveries: toMoneyString(next.assetRecoveries),
        finalAmount: toMoneyString(total),
      },
      note: body.reason,
    })
    return updated
  })
}

/**
 * An idempotent rebuild while DRAFT, exactly like `processRun`.
 *
 * Gated on the same attendance condition as a run: a leaver's final days are
 * the ones most likely to be left pending approval.
 */
export async function calculateSettlement(employeeId: string, actorUserId: string) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { salaryStructure: { include: { components: true } } },
  })
  if (!employee) throw new AppError(404, "Employee not found")

  if (!employee.lastWorkingDay || !employee.exitReason) {
    throw new AppError(
      409,
      "This employee has no exit details. Record a last working day and an exit reason before calculating a settlement."
    )
  }
  if (!employee.salaryStructure) {
    throw new AppError(409, "This employee has no salary structure, so no settlement can be computed")
  }

  const existing = await prisma.settlement.findFirst({
    where: { employeeId, status: { in: ["DRAFT", "APPROVED"] } },
  })
  if (existing && existing.status !== "DRAFT") {
    throw new AppError(409, `A settlement for this employee is already ${existing.status.toLowerCase()}`)
  }

  const lastWorkingDay = employee.lastWorkingDay
  const month = lastWorkingDay.getUTCMonth() + 1
  const year = lastWorkingDay.getUTCFullYear()

  // The same gate a run applies. A leaver's final days are exactly the ones
  // most likely to be sitting unapproved.
  const summaries = await getMonthlySummary(SYSTEM_ACTOR, month, year)
  const summary = summaries.find((s) => s.employee.id === employeeId)
  if (summary && summary.pendingApproval > 0) {
    throw new AppError(
      409,
      `${summary.pendingApproval} attendance day(s) in the exit month are still unapproved. Approve them before calculating.`
    )
  }

  const structure = employee.salaryStructure
  const currency = structure.currency
  const fxRateToBdt =
    currency === REPORTING_CURRENCY ? dec(1) : await resolveRateOrThrow(currency, lastWorkingDay)

  const { to: monthEnd } = monthRange(year, month)
  const calendarDays = monthEnd.getUTCDate()
  const daysEmployed = lastWorkingDay.getUTCDate()

  const components = toComponentInputs(structure.components)
  const componentsWithFlags = structure.components.map((c) => ({
    ...toComponentInputs([c])[0],
    countsAsWages: c.countsAsWages,
  }))

  const pending = computePendingSalary({
    basic: dec(structure.basic),
    components,
    calendarDays,
    daysEmployed,
    lopDays: summary ? summary.absent + summary.onUnpaidLeave : 0,
    workingDays: summary?.workingDays ?? 0,
    present: summary?.present ?? 0,
    onPaidLeave: summary?.onPaidLeave ?? 0,
  })

  const base = wagesBase(dec(structure.basic), componentsWithFlags)
  const completed = completedServiceYears(employee.joiningDate, lastWorkingDay)
  const years = serviceYears(employee.joiningDate, lastWorkingDay)
  const gratuity = computeGratuity(base, completed, employee.exitReason)
  // Notice served is not modelled as a field; the exit note records the
  // human circumstance, and Finance overrides the head if it was served.
  const notice = computeNoticePay(base, employee.exitReason, false)

  // Sweep approved claims not already taken by a payslip or settlement.
  const claims = await prisma.expenseClaim.findMany({
    where: { employeeId, status: "APPROVED", payslipId: null, settlementId: null },
  })
  const expenseReimbursement = claims.reduce((total, claim) => {
    const inBdt = dec(claim.amount).times(claim.fxRateToBdt ?? dec(1))
    return total.plus(currency === REPORTING_CURRENCY ? inBdt : inBdt.dividedBy(fxRateToBdt))
  }, dec(0))

  const heads = {
    pendingSalary: pending.netPay,
    gratuity: gratuity.amount,
    noticePay: notice.amount,
    expenseReimbursement,
    // Always 0 this phase: encashing a derived earned-leave balance needs a
    // rule for freezing it at exit, which is out of scope.
    leaveEncashment: dec(0),
    outstandingDeductions: dec(0),
    assetRecoveries: dec(0),
  }
  const total = finalAmount(heads)

  const breakdown = {
    currency,
    fxRateToBdt: fxRateToBdt.toFixed(6),
    exitReason: employee.exitReason,
    exitLabel: EXIT_POLICIES[employee.exitReason].label,
    lastWorkingDay: lastWorkingDay.toISOString().slice(0, 10),
    serviceYears: years.toFixed(2),
    completedYears: completed,
    pendingSalary: {
      calendarDays,
      daysEmployed,
      payableDays: pending.payableDays.toFixed(2),
      grossPay: toMoneyString(pending.grossPay),
      totalDeductions: toMoneyString(pending.totalDeductions),
      netPay: toMoneyString(pending.netPay),
      lines: pending.breakdown,
    },
    gratuity: { ...gratuity, amount: toMoneyString(gratuity.amount) },
    notice: { ...notice, amount: toMoneyString(notice.amount) },
    claims: claims.map((c) => ({
      claimId: c.id,
      category: c.categoryId,
      spentCurrency: c.currency,
      spentAmount: toMoneyString(c.amount),
      fxRateToBdt: (c.fxRateToBdt ?? dec(1)).toFixed(6),
    })),
  }

  return prisma.$transaction(async (tx) => {
    // Idempotent rebuild: drop the previous draft and release its claims,
    // exactly as processRun does for a run.
    if (existing) {
      await tx.expenseClaim.updateMany({
        where: { settlementId: existing.id },
        data: { settlementId: null },
      })
      await tx.settlement.delete({ where: { id: existing.id } })
    }

    const counter = await tx.idCounter.upsert({
      where: { id: "STL" },
      update: { value: { increment: 1 } },
      create: { id: "STL", value: 1 },
    })

    const settlement = await tx.settlement.create({
      data: {
        settlementNo: `BS-STL-${String(counter.value).padStart(6, "0")}`,
        employeeId,
        status: "DRAFT",
        lastWorkingDay,
        exitReason: employee.exitReason!,
        serviceYears: years,
        currency,
        fxRateToBdt,
        ...heads,
        finalAmount: total,
        finalAmountBdt: bdtTotal(total, fxRateToBdt),
        breakdown: breakdown as unknown as Prisma.InputJsonValue,
        calculatedBy: actorUserId,
        calculatedAt: new Date(),
      },
      include: SETTLEMENT_INCLUDE,
    })

    if (claims.length > 0) {
      await tx.expenseClaim.updateMany({
        where: { id: { in: claims.map((c) => c.id) } },
        data: { settlementId: settlement.id },
      })
    }

    await writeAudit(tx, {
      entity: "SETTLEMENT",
      entityId: settlement.id,
      action: "CREATE",
      changedBy: actorUserId,
      after: { employeeId, finalAmount: toMoneyString(total), currency },
    })
    await emitEvent(
      tx,
      settlementEvent({
        stage: "calculated",
        settlementId: settlement.id,
        settlementNo: settlement.settlementNo,
        employeeId,
        employeeName: settlement.employee.fullName,
        actorUserId,
      })
    )

    return settlement
  })
}

export async function getSettlement(employeeId: string) {
  const settlement = await prisma.settlement.findFirst({
    where: { employeeId },
    include: SETTLEMENT_INCLUDE,
    orderBy: { generatedAt: "desc" },
  })
  if (!settlement) throw new AppError(404, "No settlement exists for this employee")
  return settlement
}

export async function listSettlements() {
  return prisma.settlement.findMany({
    include: SETTLEMENT_INCLUDE,
    orderBy: { generatedAt: "desc" },
  })
}

/** Super Admin only, and never the person who calculated it. */
export async function approveSettlement(id: string, actorUserId: string) {
  const settlement = await prisma.settlement.findUnique({ where: { id } })
  if (!settlement) throw new AppError(404, "Settlement not found")
  if (settlement.status !== "DRAFT") {
    throw new AppError(409, `This settlement is already ${settlement.status.toLowerCase()}`)
  }
  if (settlement.calculatedBy === actorUserId) {
    throw new AppError(403, "You calculated this settlement and cannot also approve it")
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.settlement.update({
      where: { id },
      data: { status: "APPROVED", approvedBy: actorUserId, approvedAt: new Date() },
      include: SETTLEMENT_INCLUDE,
    })
    await postSettlementAccrual(tx, id, actorUserId)
    await writeAudit(tx, {
      entity: "SETTLEMENT",
      entityId: id,
      action: "APPROVE",
      changedBy: actorUserId,
    })
    await emitEvent(
      tx,
      settlementEvent({
        stage: "approved",
        settlementId: id,
        settlementNo: updated.settlementNo,
        employeeId: updated.employeeId,
        employeeName: updated.employee.fullName,
        actorUserId,
      })
    )
    return updated
  })
}

export async function rejectSettlement(id: string, actorUserId: string, body: SettlementRejectBody) {
  const settlement = await prisma.settlement.findUnique({ where: { id } })
  if (!settlement) throw new AppError(404, "Settlement not found")
  if (settlement.status !== "DRAFT") {
    throw new AppError(409, `This settlement is already ${settlement.status.toLowerCase()}`)
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.settlement.update({
      where: { id },
      data: { rejectionNote: body.note },
      include: SETTLEMENT_INCLUDE,
    })
    await writeAudit(tx, {
      entity: "SETTLEMENT",
      entityId: id,
      action: "REJECT",
      changedBy: actorUserId,
      note: body.note,
    })
    return updated
  })
}

/** Terminal. Marks the swept claims REIMBURSED, as disbursing a run does. */
/**
 * The heads that were actually worth something, in the order the statement
 * reads. A zero head is left out rather than printed as `0` — a leaver reading
 * "Leave encashment: 0" learns nothing except that a line exists.
 *
 * Deductions are shown as they are stored, positive, and labelled as
 * deductions; `finalAmount` has already subtracted them.
 */
const STATEMENT_HEADS = [
  ["pendingSalary", "Pending salary"],
  ["gratuity", "Gratuity"],
  ["noticePay", "Notice pay"],
  ["expenseReimbursement", "Expense reimbursement"],
  ["leaveEncashment", "Leave encashment"],
  ["outstandingDeductions", "Less: outstanding deductions"],
  ["assetRecoveries", "Less: asset recoveries"],
] as const

/**
 * Email the leaver their statement.
 *
 * After the transaction and swallowed inside `notify`: a payment that already
 * committed must not be undone by a mail server.
 *
 * Known hole, recorded rather than closed here: the address on file is the
 * company email, which is often shut off the day someone leaves, and
 * `Employee` has no personal email field. The one email whose recipient most
 * needs it is the most likely to bounce — a failed row on /admin/emails is
 * how anyone finds out.
 */
async function notifySettlementPaid(settlementId: string): Promise<void> {
  const row = await prisma.settlement.findUnique({
    where: { id: settlementId },
    select: {
      currency: true,
      finalAmount: true,
      pendingSalary: true,
      gratuity: true,
      noticePay: true,
      expenseReimbursement: true,
      leaveEncashment: true,
      outstandingDeductions: true,
      assetRecoveries: true,
      employee: { select: { fullName: true, user: { select: { email: true } } } },
    },
  })
  const to = row?.employee?.user?.email
  if (!row || !to) return

  const lines = STATEMENT_HEADS.filter(([key]) => !row[key].isZero()).map(([key, label]) => ({
    label,
    amount: toMoneyString(row[key]),
  }))

  await sendSettlementStatementEmail({
    to,
    settlementId,
    fullName: row.employee.fullName,
    currency: row.currency,
    lines,
    netPayable: toMoneyString(row.finalAmount),
  })
}

export async function paySettlement(id: string, actorUserId: string) {
  const settlement = await prisma.settlement.findUnique({ where: { id } })
  if (!settlement) throw new AppError(404, "Settlement not found")
  if (settlement.status !== "APPROVED") {
    throw new AppError(
      409,
      `Cannot pay a settlement that is ${settlement.status.toLowerCase()} — it must be approved first`
    )
  }

  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.settlement.update({
      where: { id },
      data: { status: "PAID", paidBy: actorUserId, paidAt: new Date() },
      include: SETTLEMENT_INCLUDE,
    })
    await sweepClaimsReimbursed(tx, { settlementId: id, status: "APPROVED" }, actorUserId)
    // The recoveries this settlement folded into its assetRecoveries head.
    await sweepRecoveriesCollected(tx, { settlementId: id, status: "PENDING" }, actorUserId)
    await postSettlementPayment(tx, id, actorUserId, updated.paidAt ?? new Date())
    await writeAudit(tx, {
      entity: "SETTLEMENT",
      entityId: id,
      action: "PAY",
      changedBy: actorUserId,
    })
    await emitEvent(
      tx,
      settlementEvent({
        stage: "paid",
        settlementId: id,
        settlementNo: updated.settlementNo,
        employeeId: updated.employeeId,
        employeeName: updated.employee.fullName,
        actorUserId,
      })
    )
    return updated
  })

  await notifySettlementPaid(id)
  return updated
}
