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
import {
  sendExpenseRejectedEmail,
  sendExpensesApprovedEmail,
} from "../notification/notification.mailer"
import { expenseEvent } from "./expense.events"
import { resolveRateOrThrow } from "../payroll/payroll.fx"
import { dec, toMoneyString } from "../payroll/payroll.money"
import { postExpenseAccrual } from "./expense.posting"
import { destroyAsset } from "../media/media.service"
import type {
  ApproveClaimBody,
  ClaimQuery,
  CreateClaimBody,
  RejectClaimBody,
  UpdateClaimBody,
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

/** Who may see and decide anybody's claim. Exported for `expense.media.ts`,
 *  which has to answer the same question about receipts. */
export const PAYROLL_ADMIN_ROLES = ["HR_ADMIN", "FINANCE_OFFICER", "SUPER_ADMIN"]

/**
 * Category codes whose claims describe a journey, and therefore carry a From
 * and a To.
 *
 * Keyed on `code`, not on `name`, and not on a column: expense categories are
 * created by Finance at runtime with no seed behind them, and `code` is
 * already the stable key the posting rules resolve against
 * (`EXPENSE_ACCRUAL/TRAVEL` → 5208). A `name` match would break the first time
 * somebody renames the category to "Travel & Conveyance".
 *
 * Adding a second route-bearing category means adding its code here. The
 * alternative — an `isTravel` column Finance ticks — is the better long-term
 * shape and is worth doing if this set ever grows past a couple of entries.
 */
export const ROUTE_CATEGORY_CODES = new Set(["TRAVEL", "CONVEYANCE"])

export const hasRoute = (code: string): boolean => ROUTE_CATEGORY_CODES.has(code.toUpperCase())

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
        name: body.name,
        amount: dec(body.amount),
        categoryId: category.id,
        currency: body.currency,
        expenseDate,
        description: body.description,
        receiptUrl: body.receiptUrl,
        // Stored only when the category actually has a route. A "from" on a
        // stationery claim is a field somebody filled in by accident, and it
        // would print on the report as though the journey happened.
        travelFrom: hasRoute(category.code) ? body.travelFrom : null,
        travelTo: hasRoute(category.code) ? body.travelTo : null,
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
 * second round trip, and so the decision emails can name a claim the
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

/** How a claim is named to the person who filed it: the table has no claim
 *  number, so it is the category and the spend date, as the row reads. */
const claimRefOf = (claim: DecidedClaim) =>
  `${claim.category?.name ?? "an expense"} on ${formatDateOnly(claim.expenseDate)}`

/**
 * Tell the claimant their claim was declined. After the transaction and
 * swallowed inside `notify`: a decision that already committed must not be
 * undone by a mail server, and a claimant with no login has nobody to tell.
 *
 * Approvals do not come through here — they are grouped per employee and sent
 * once per sweep by `notifyApprovals`.
 */
async function notifyExpenseRejected(claim: DecidedClaim, reason: string): Promise<void> {
  const to = claim.employee?.user?.email
  if (!to) return
  await sendExpenseRejectedEmail({
    to,
    claimId: claim.id,
    claimRef: claimRefOf(claim),
    amount: toMoneyString(claim.amount),
    currency: claim.currency,
    reason,
  })
}

/**
 * One email per employee, listing everything approved for them in this sweep.
 *
 * The grouping lives here rather than in the caller so that a single approval
 * and a batch of twelve take the same path — a batch of one is just a batch.
 * Totals are summed per currency and never across them.
 */
async function notifyApprovals(claims: DecidedClaim[]): Promise<void> {
  const byRecipient = new Map<string, DecidedClaim[]>()
  for (const claim of claims) {
    const to = claim.employee?.user?.email
    if (!to) continue
    byRecipient.set(to, [...(byRecipient.get(to) ?? []), claim])
  }

  for (const [to, list] of byRecipient) {
    const totals = new Map<string, ReturnType<typeof dec>>()
    for (const claim of list) {
      const running = totals.get(claim.currency)
      totals.set(claim.currency, running ? running.plus(dec(claim.amount)) : dec(claim.amount))
    }

    await sendExpensesApprovedEmail({
      to,
      claims: list.map((claim) => ({
        claimId: claim.id,
        claimRef: claimRefOf(claim),
        amount: toMoneyString(claim.amount),
        currency: claim.currency,
      })),
      totals: [...totals.entries()]
        .map(([currency, amount]) => ({ currency, amount: toMoneyString(amount) }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
    })
  }
}

/**
 * Everything an approval does to one claim, minus the email.
 *
 * Split out so the single and batch paths cannot drift: the batch loops this,
 * one transaction each. One transaction for the whole batch would mean a
 * single claim with no covering exchange rate rolling back every correct
 * approval beside it — see `docs/adr/0004`.
 */
async function approveOne(id: string, actorUserId: string, note?: string) {
  const claim = await prisma.expenseClaim.findUnique({ where: { id }, include: DECISION_INCLUDE })
  if (!claim) throw new AppError(404, "Expense claim not found")
  if (claim.status !== "PENDING") {
    throw new AppError(409, `This claim is already ${claim.status.toLowerCase()}`)
  }

  // Throws a 409 naming the currency and date when no rate covers the spend
  // date — never defaults, for the same reason payroll never does.
  const fxRateToBdt = await resolveRateOrThrow(claim.currency, claim.expenseDate)

  const updated = await runApproval(id, actorUserId, claim, fxRateToBdt, note)
  return { claim, updated }
}

export async function approveClaim(id: string, actorUserId: string, body: ApproveClaimBody) {
  const { claim, updated } = await approveOne(id, actorUserId, body.note)
  await notifyApprovals([claim])
  return updated
}

/**
 * Approve many claims in one sweep, then send one email per employee.
 *
 * **Best-effort, not all-or-nothing.** Each claim is its own transaction and
 * its own failure: approval resolves an exchange rate against that claim's
 * spend date, so one USD claim with no covering rate must not block eleven
 * correct approvals beside it. The refusals come back named, so the caller
 * can say which ones were left and why.
 *
 * Only claims that actually committed are emailed about. A claim that threw
 * is not in the list the employee receives.
 */
export async function approveClaims(
  ids: string[],
  actorUserId: string
): Promise<{
  approved: string[]
  failed: Array<{ id: string; reason: string }>
}> {
  const approved: DecidedClaim[] = []
  const failed: Array<{ id: string; reason: string }> = []

  // Sequential, not `Promise.all`: each approval posts to the ledger, and
  // concurrent journal writes against the same period would contend for the
  // same rows for no gain on a batch this size.
  for (const id of ids) {
    try {
      const { claim } = await approveOne(id, actorUserId)
      approved.push(claim)
    } catch (err) {
      failed.push({
        id,
        reason: err instanceof AppError ? err.message : "Could not be approved",
      })
    }
  }

  await notifyApprovals(approved)
  return { approved: approved.map((c) => c.id), failed }
}

/** The write itself, shared by every approval path. */
async function runApproval(
  id: string,
  actorUserId: string,
  claim: { employeeId: string; categoryId: string; currency: string; amount: Parameters<typeof toMoneyString>[0] },
  fxRateToBdt: Awaited<ReturnType<typeof resolveRateOrThrow>>,
  note: string | undefined
) {
  const body = { note }
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

  // No email here. Approvals are grouped per employee and sent once per
  // sweep by the caller, so that twelve approvals are one email and not
  // twelve.
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

  await notifyExpenseRejected(claim, body.note)
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

/**
 * Amending a claim you filed, and withdrawing one.
 *
 * Both are **owner-only and PENDING-only**, and the two conditions do
 * different jobs. Owner-only is the obvious one. PENDING-only is the one worth
 * spelling out: once Finance has decided a claim, its figures are the basis of
 * that decision, and REIMBURSED ones are joined to a payslip that has already
 * paid the amount. Editing either would silently rewrite history somebody
 * relied on, so both refuse with a message naming the status.
 *
 * Finance is deliberately *not* given an edit here. Their tool for a wrong
 * claim is reject-with-a-note, which leaves a record of the disagreement;
 * quietly correcting somebody's figures and then approving them does not.
 */
async function ownPendingClaim(actor: AccessTokenPayload, claimId: string) {
  const self = await requireEmployeeForUser(actor.sub)
  const claim = await prisma.expenseClaim.findUnique({ where: { id: claimId } })
  if (!claim) throw new AppError(404, "Expense claim not found")
  if (claim.employeeId !== self.id) {
    throw new AppError(403, "You may only change your own expense claims")
  }
  if (claim.status !== "PENDING") {
    throw new AppError(
      409,
      `This claim has already been ${claim.status.toLowerCase()}, so it can no longer be changed.`
    )
  }
  return claim
}

export async function updateClaim(
  actor: AccessTokenPayload,
  claimId: string,
  body: UpdateClaimBody
) {
  const claim = await ownPendingClaim(actor, claimId)

  // Re-run the same date rules as creation. Without this, an edit is a way
  // round the age limit and the future-date check that creation enforces.
  let expenseDate = claim.expenseDate
  if (body.expenseDate !== undefined) {
    expenseDate = parseDateOnly(body.expenseDate)
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
  }

  return prisma.$transaction(async (tx) => {
    // Resolved even when the category is unchanged: the route rule below has
    // to know whether the *effective* category carries one.
    const categoryId = body.categoryId ?? claim.categoryId
    const category = await tx.expenseCategory.findUnique({ where: { id: categoryId } })
    if (!category) throw new AppError(400, "Choose a valid expense category")

    // Moving a claim off a travel category takes its route with it, or the
    // report prints a journey against a stationery bill.
    const keepsRoute = hasRoute(category.code)
    const travelFrom = keepsRoute ? (body.travelFrom ?? claim.travelFrom) : null
    const travelTo = keepsRoute ? (body.travelTo ?? claim.travelTo) : null

    const updated = await tx.expenseClaim.update({
      where: { id: claim.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.amount !== undefined ? { amount: dec(body.amount) } : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        categoryId,
        expenseDate,
        travelFrom,
        travelTo,
      },
      include: CLAIM_INCLUDE,
    })

    await writeAudit(tx, {
      entity: "EXPENSE_CLAIM",
      entityId: claim.id,
      action: "UPDATE",
      changedBy: actor.sub,
      before: {
        name: claim.name,
        amount: toMoneyString(claim.amount),
        currency: claim.currency,
        categoryId: claim.categoryId,
        expenseDate: formatDateOnly(claim.expenseDate),
      },
      after: {
        name: updated.name,
        amount: toMoneyString(updated.amount),
        currency: updated.currency,
        categoryId: updated.categoryId,
        expenseDate: formatDateOnly(updated.expenseDate),
      },
    })

    return updated
  })
}

/**
 * Withdrawing a claim.
 *
 * A hard delete, not a status. A PENDING claim nobody has acted on has no
 * history worth keeping — the audit row below is the record that it existed —
 * and a WITHDRAWN status would be a fifth state every report, filter and
 * total would have to learn to ignore.
 *
 * The Cloudinary blobs go first. `ExpenseAttachment` cascades on delete, so
 * dropping the claim would take the rows and leave the files behind with
 * nothing pointing at them — an invisible leak that grows.
 */
export async function deleteClaim(actor: AccessTokenPayload, claimId: string): Promise<void> {
  const claim = await ownPendingClaim(actor, claimId)

  const attachments = await prisma.expenseAttachment.findMany({
    where: { claimId },
    select: { publicId: true },
  })
  // Outside the transaction, and before it: a transaction held across a
  // Cloudinary round-trip pins a connection-pool slot, and a blob destroyed
  // for a claim that then fails to delete is recoverable while the reverse
  // is not.
  for (const attachment of attachments) {
    await destroyAsset(attachment.publicId)
  }

  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, {
      entity: "EXPENSE_CLAIM",
      entityId: claim.id,
      action: "DELETE",
      changedBy: actor.sub,
      before: {
        name: claim.name,
        amount: toMoneyString(claim.amount),
        currency: claim.currency,
        expenseDate: formatDateOnly(claim.expenseDate),
        receipts: attachments.length,
      },
    })
    await tx.expenseClaim.delete({ where: { id: claim.id } })
  })
}
