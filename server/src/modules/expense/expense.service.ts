/**
 * Expense claims: submit, review, and the frozen spend-date conversion.
 */

import { requireEmployeeForUser } from "../attendance/attendance.service"
import { officeToday } from "../attendance/attendance.time"
import type { AccessTokenPayload } from "../auth/auth.types"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import { formatDateOnly, parseDateOnly } from "../../utils/dates"
import { emitEvent } from "../event/event.emit"
import { sendExpenseDecidedEmail } from "../notification/notification.mailer"
import { expenseEvent } from "./expense.events"
import { resolveRateOrThrow } from "../payroll/payroll.fx"
import { dec, toMoneyString } from "../payroll/payroll.money"
import { postExpenseAccrual } from "./expense.posting"
import type {
  ApproveClaimBody,
  ClaimQuery,
  CreateClaimBody,
  RejectClaimBody,
} from "./expense.validators"

/**
 * A claim older than this is refused. Long enough to cover an ordinary
 * approval delay across a month boundary, short enough that a claim cannot
 * surface against a payroll month long since closed.
 */
export const MAX_CLAIM_AGE_DAYS = 90

const CLAIM_INCLUDE = {
  employee: { select: { id: true, fullName: true, employeeCode: true } },
  category: { select: { id: true, code: true, name: true } },
  payslip: { select: { id: true, payslipNo: true, payrollRunId: true } },
} as const

const PAYROLL_ADMIN_ROLES = ["HR_ADMIN", "FINANCE_OFFICER", "SUPER_ADMIN"]

export async function createClaim(actor: AccessTokenPayload, body: CreateClaimBody) {
  const self = await requireEmployeeForUser(actor.sub)
  const expenseDate = parseDateOnly(body.expenseDate)
  const today = officeToday()

  if (expenseDate.getTime() > today.getTime()) {
    throw new AppError(400, "An expense cannot be dated in the future")
  }
  const ageDays = Math.floor((today.getTime() - expenseDate.getTime()) / 86_400_000)
  if (ageDays > MAX_CLAIM_AGE_DAYS) {
    throw new AppError(
      400,
      `This expense is ${ageDays} days old. Claims must be submitted within ${MAX_CLAIM_AGE_DAYS} days of the spend date.`
    )
  }

  return prisma.$transaction(async (tx) => {
    const category = await tx.expenseCategory.findUnique({ where: { id: body.categoryId } })
    if (!category) throw new AppError(400, "Choose a valid expense category")
    const claim = await tx.expenseClaim.create({
      data: {
        employeeId: self.id,
        amount: dec(body.amount),
         categoryId: category.id,
        currency: body.currency,
        expenseDate,
        description: body.description,
        receiptUrl: body.receiptUrl,
      },
    })
    await writeAudit(tx, {
      entity: "EXPENSE_CLAIM",
      entityId: claim.id,
      action: "CREATE",
      changedBy: actor.sub,
      after: {
        employeeId: claim.employeeId,
        amount: toMoneyString(claim.amount),
        currency: claim.currency,
        expenseDate: body.expenseDate,
      },
    })
    await emitEvent(
      tx,
      expenseEvent({
        stage: "submitted",
        claimId: claim.id,
        employeeId: claim.employeeId,
        category: claim.categoryId,
        amount: toMoneyString(claim.amount),
        currency: claim.currency,
        actorUserId: actor.sub,
      })
    )
    return claim
  })
}

export async function getMyClaims(actor: AccessTokenPayload) {
  const self = await requireEmployeeForUser(actor.sub)
  return prisma.expenseClaim.findMany({
    where: { employeeId: self.id },
    include: CLAIM_INCLUDE,
    orderBy: { createdAt: "desc" },
  })
}

export async function listClaims(query: ClaimQuery) {
  return prisma.expenseClaim.findMany({
    where: { status: query.status, employeeId: query.employeeId },
    include: CLAIM_INCLUDE,
    orderBy: { createdAt: "desc" },
  })
}

/**
 * Freezes the FX rate at approval, from the **spend date** — the one place
 * the payroll run's rate is deliberately not used.
 *
 * A claim reimburses a specific past outlay: what someone is owed for an $80
 * spend on 3 July is what $80 was worth on 3 July. Using the payroll month's
 * rate would make the refund depend on how long approval took, which is both
 * wrong and gameable.
 */
/**
 * The claimant's login and the two fields the expenses table identifies a row
 * by. Pulled in on the decision paths so the notification does not need a
 * second round trip, and so `sendExpenseDecidedEmail` can name a claim the
 * reader will recognise — `ExpenseClaim` has no claim number.
 */
const DECISION_INCLUDE = {
  employee: { select: { user: { select: { email: true } } } },
  category: { select: { name: true } },
} as const

type DecidedClaim = {
  id: string
  currency: string
  amount: Parameters<typeof toMoneyString>[0]
  expenseDate: Date
  employee?: { user: { email: string } | null } | null
  category?: { name: string } | null
}

/**
 * Tell the claimant. After the transaction and swallowed inside `notify`: a
 * decision that already committed must not be undone by a mail server, and a
 * claimant with no login has nobody to tell.
 */
async function notifyExpenseDecision(
  claim: DecidedClaim,
  approved: boolean,
  reason: string | null
): Promise<void> {
  const to = claim.employee?.user?.email
  if (!to) return
  const category = claim.category?.name ?? "an expense"
  await sendExpenseDecidedEmail({
    to,
    claimId: claim.id,
    claimRef: `${category} on ${formatDateOnly(claim.expenseDate)}`,
    amount: toMoneyString(claim.amount),
    currency: claim.currency,
    approved,
    reason,
  })
}

export async function approveClaim(id: string, actorUserId: string, body: ApproveClaimBody) {
  const claim = await prisma.expenseClaim.findUnique({ where: { id }, include: DECISION_INCLUDE })
  if (!claim) throw new AppError(404, "Expense claim not found")
  if (claim.status !== "PENDING") {
    throw new AppError(409, `This claim is already ${claim.status.toLowerCase()}`)
  }

  // Throws a 409 naming the currency and date when no rate covers the spend
  // date — never defaults, for the same reason payroll never does.
  const fxRateToBdt = await resolveRateOrThrow(claim.currency, claim.expenseDate)

  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.expenseClaim.update({
      where: { id },
      data: {
        status: "APPROVED",
        fxRateToBdt,
        reviewedBy: actorUserId,
        reviewedAt: new Date(),
        reviewNote: body.note,
      },
    })
    await postExpenseAccrual(tx, id, actorUserId)
    await writeAudit(tx, {
      entity: "EXPENSE_CLAIM",
      entityId: id,
      action: "APPROVE",
      changedBy: actorUserId,
      after: { status: "APPROVED", fxRateToBdt: fxRateToBdt.toFixed(6) },
      note: body.note,
    })
    await emitEvent(
      tx,
      expenseEvent({
        stage: "approved",
        claimId: id,
        employeeId: claim.employeeId,
        category: claim.categoryId,
        amount: toMoneyString(claim.amount),
        currency: claim.currency,
        actorUserId: actorUserId,
        note: body.note,
      })
    )
    return updated
  })

  await notifyExpenseDecision(claim, true, body.note ?? null)
  return updated
}

export async function rejectClaim(id: string, actorUserId: string, body: RejectClaimBody) {
  const claim = await prisma.expenseClaim.findUnique({ where: { id }, include: DECISION_INCLUDE })
  if (!claim) throw new AppError(404, "Expense claim not found")
  if (claim.status !== "PENDING") {
    throw new AppError(409, `This claim is already ${claim.status.toLowerCase()}`)
  }

  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.expenseClaim.update({
      where: { id },
      data: {
        status: "REJECTED",
        reviewedBy: actorUserId,
        reviewedAt: new Date(),
        reviewNote: body.note,
      },
    })
    await writeAudit(tx, {
      entity: "EXPENSE_CLAIM",
      entityId: id,
      action: "REJECT",
      changedBy: actorUserId,
      after: { status: "REJECTED" },
      note: body.note,
    })
    await emitEvent(
      tx,
      expenseEvent({
        stage: "rejected",
        claimId: id,
        employeeId: claim.employeeId,
        category: claim.categoryId,
        amount: toMoneyString(claim.amount),
        currency: claim.currency,
        actorUserId,
        note: body.note,
      })
    )
    return updated
  })

  await notifyExpenseDecision(claim, false, body.note ?? null)
  return updated
}

export async function getClaim(actor: AccessTokenPayload, id: string) {
  const claim = await prisma.expenseClaim.findUnique({ where: { id }, include: CLAIM_INCLUDE })
  if (!claim) throw new AppError(404, "Expense claim not found")
  if (!PAYROLL_ADMIN_ROLES.includes(actor.role)) {
    const self = await requireEmployeeForUser(actor.sub)
    if (claim.employeeId !== self.id) {
      throw new AppError(403, "You may only view your own expense claims")
    }
  }
  return claim
}
