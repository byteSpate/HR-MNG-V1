/**
 * Asset recoveries — the debt half of the register.
 *
 * A recovery records that a debt exists, who priced it and why. It does
 * nothing to money on its own (spec Decision 3): collecting it mid-employment
 * is `recoverFromPayroll`, a separate explicit act that creates a
 * PayrollAdjustment and stops.
 *
 * Decision 7: editable while PENDING, frozen afterwards, delete refused at
 * every status — a PENDING recovery that turns out to be a mistake is waived
 * with a reason saying so.
 */

import prisma from "../../config/prisma"
import type { AssetRecovery, AssetRecoveryStatus, Prisma } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import { dec, round2 } from "../payroll/payroll.money"
import type { CreateRecoveryBody, UpdateRecoveryBody } from "./asset.recoveries.validators"
import { loadPayrollSettings } from "../payroll/payroll.settings"

const RECOVERY = "ASSET_RECOVERY"

function loadRecovery(tx: Prisma.TransactionClient, id: string) {
  return tx.assetRecovery.findUnique({
    where: { id },
    include: {
      adjustment: { include: { payslip: { select: { payslipNo: true } } } },
      settlement: { select: { settlementNo: true } },
      asset: { select: { assetTag: true, name: true } },
    },
  })
}

/** What collected a recovery, for the "refuses because it is already gone"
 *  messages — a payslip number, a settlement number, or neither. */
function collectedBy(recovery: Awaited<ReturnType<typeof loadRecovery>>): string | null {
  if (recovery?.adjustment?.payslip?.payslipNo) return recovery.adjustment.payslip.payslipNo
  if (recovery?.settlement?.settlementNo) return recovery.settlement.settlementNo
  return null
}

/**
 * A recovery needs a custody link: the asset must have been assigned to the
 * employee at some point, or the caller names the assignment it arose under.
 * An asset the employee never held cannot be recovered from them.
 */
async function assertCustodyLink(
  tx: Prisma.TransactionClient,
  body: CreateRecoveryBody
): Promise<string | null> {
  if (body.assignmentId) return body.assignmentId

  const assignment = await tx.assetAssignment.findFirst({
    where: { assetId: body.assetId, employeeId: body.employeeId },
    orderBy: { assignedAt: "desc" },
    select: { id: true },
  })
  if (assignment) return assignment.id

  const asset = await tx.asset.findUnique({
    where: { id: body.assetId },
    select: { assetTag: true },
  })
  throw new AppError(
    400,
    `${asset?.assetTag ?? "This asset"} has no assignment history with this employee, so a recovery cannot be raised against them.`
  )
}

/**
 * The shared core behind `createRecovery` and the in-transaction call from
 * `markAssetLost` / `returnAsset` (Decision 4): marking an asset lost and
 * pricing the recovery commit or roll back together, so a laptop is never
 * marked lost with no debt recorded.
 */
export async function createRecoveryIn(
  tx: Prisma.TransactionClient,
  body: CreateRecoveryBody,
  actor: AccessTokenPayload
): Promise<AssetRecovery> {
  if (!body.reason.trim()) {
    throw new AppError(400, "A reason is required", { field: "reason" })
  }
  const amount = round2(dec(body.amount))
  if (amount.lessThanOrEqualTo(0)) {
    throw new AppError(
      400,
      "A recovery amount must be greater than zero. A zero-value recovery is a waiver — waive it instead.",
      { field: "amount" }
    )
  }

  const assignmentId = await assertCustodyLink(tx, body)

  const recovery = await tx.assetRecovery.create({
    data: {
      assetId: body.assetId,
      employeeId: body.employeeId,
      assignmentId,
      kind: body.kind ?? "NOT_RETURNED",
      amount,
      currency: body.currency ?? "BDT",
      reason: body.reason.trim(),
      status: "PENDING",
      createdBy: actor.sub,
    },
  })

  await writeAudit(tx, {
    entity: "ASSET_RECOVERY",
    entityId: recovery.id,
    action: "CREATE",
    changedBy: actor.sub,
    after: {
      assetId: body.assetId,
      employeeId: body.employeeId,
      amount: amount.toFixed(2),
      kind: body.kind ?? "NOT_RETURNED",
    },
  })

  return recovery
}

export function createRecovery(body: CreateRecoveryBody, actor: AccessTokenPayload): Promise<AssetRecovery> {
  return prisma.$transaction((tx) => createRecoveryIn(tx, body, actor))
}

export function updateRecovery(
  id: string,
  body: UpdateRecoveryBody,
  actor: AccessTokenPayload
): Promise<AssetRecovery> {
  return prisma.$transaction(async (tx) => {
    const recovery = await loadRecovery(tx, id)
    if (!recovery) throw new AppError(404, "Recovery not found")
    if (recovery.status !== "PENDING") {
      const collected = collectedBy(recovery)
      throw new AppError(
        409,
        `This recovery is ${recovery.status.toLowerCase()}${collected ? ` — ${collected} collected it` : ""}. Correction is a fresh document, not an edit.`,
        { recoveryId: id }
      )
    }

    const data: Prisma.AssetRecoveryUpdateInput = {}
    if (body.amount !== undefined) {
      const amount = round2(dec(body.amount))
      if (amount.lessThanOrEqualTo(0)) {
        throw new AppError(
          400,
          "A recovery amount must be greater than zero. A zero-value recovery is a waiver — waive it instead.",
          { field: "amount" }
        )
      }
      data.amount = amount
    }
    if (body.currency !== undefined) data.currency = body.currency
    if (body.reason !== undefined) data.reason = body.reason.trim()

    const updated = await tx.assetRecovery.update({ where: { id }, data })

    await writeAudit(tx, {
      entity: "ASSET_RECOVERY",
      entityId: id,
      action: "UPDATE",
      changedBy: actor.sub,
      after: {
        amount: data.amount ? dec(data.amount as unknown as string).toFixed(2) : undefined,
        currency: data.currency ?? undefined,
        reason: data.reason ?? undefined,
      },
    })

    return updated
  })
}

export function waiveRecovery(
  id: string,
  body: { waiverReason: string },
  actor: AccessTokenPayload
): Promise<AssetRecovery> {
  return prisma.$transaction(async (tx) => {
    if (!body.waiverReason.trim()) {
      throw new AppError(400, "A waiver reason is required", { field: "waiverReason" })
    }

    const recovery = await loadRecovery(tx, id)
    if (!recovery) throw new AppError(404, "Recovery not found")
    if (recovery.status === "WAIVED") {
      throw new AppError(
        409,
        "This recovery has already been waived. A waiver has a named author and a reason; un-waiving would erase that. Record a new recovery instead."
      )
    }
    if (recovery.status === "RECOVERED") {
      const collected = collectedBy(recovery)
      throw new AppError(
        409,
        `This recovery was already collected${collected ? ` by ${collected}` : ""}. It cannot be waived.`,
        { recoveryId: id }
      )
    }

    const updated = await tx.assetRecovery.update({
      where: { id },
      data: {
        status: "WAIVED",
        waivedBy: actor.sub,
        waivedAt: new Date(),
        waiverReason: body.waiverReason.trim(),
      },
    })

    await writeAudit(tx, {
      entity: "ASSET_RECOVERY",
      entityId: id,
      action: "WAIVE",
      changedBy: actor.sub,
      before: { status: "PENDING" },
      after: { status: "WAIVED", waiverReason: body.waiverReason.trim() },
    })

    return updated
  })
}

export function listRecoveries(
  query: { employeeId?: string; status?: AssetRecoveryStatus; assetId?: string } = {},
  viewer?: AccessTokenPayload
): Promise<AssetRecovery[]> {
  return prisma.$transaction(async (tx) => {
    // An employee sees their own recoveries and nobody else's — a deduction
    // someone can see coming is a deduction disputed before it is paid, not
    // after (spec Backend → Routes).
    let scoped = { ...query }
    if (viewer?.role === "EMPLOYEE" || viewer?.role === "REPORTING_MANAGER") {
      const me = await tx.employee.findUnique({
        where: { userId: viewer.sub },
        select: { id: true },
      })
      if (!me) return []
      scoped = { ...scoped, employeeId: me.id }
    }

    return tx.assetRecovery.findMany({
      where: {
        ...(scoped.employeeId ? { employeeId: scoped.employeeId } : {}),
        ...(scoped.status ? { status: scoped.status } : {}),
        ...(scoped.assetId ? { assetId: scoped.assetId } : {}),
      },
      include: {
        asset: { select: { assetTag: true, name: true, category: { select: { name: true } } } },
        adjustment: { include: { payslip: { select: { payslipNo: true } } } },
        settlement: { select: { settlementNo: true } },
      },
      orderBy: { createdAt: "desc" },
    })
  })
}

/** PENDING recoveries for one employee — the exit checklist's debt half. */
export function pendingRecoveriesFor(
  employeeId: string,
  tx: Prisma.TransactionClient = prisma
): Promise<AssetRecovery[]> {
  return tx.assetRecovery.findMany({
    where: { employeeId, status: "PENDING" },
    include: {
      asset: { select: { assetTag: true, name: true, category: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  })
}

/**
 * The mid-employment collection path (spec Decision 3). Creating a recovery
 * does nothing to money; turning it into a deduction is this separate act.
 * It creates a PayrollAdjustment and stops — the next run consumes it through
 * machinery that is not modified here.
 *
 * The `@unique` on `adjustmentId` is the idempotency guard: a second call
 * collides at the database, never at a service check that two rapid clicks
 * could race.
 */
export function recoverFromPayroll(id: string, actor: AccessTokenPayload): Promise<AssetRecovery> {
  return prisma.$transaction(async (tx) => {
    const { recoverAssetsFromSalary } = await loadPayrollSettings(tx)
    if (!recoverAssetsFromSalary) {
      throw new AppError(
        409,
        "Taking money from salary for assets is turned off. To turn it on, go to Settings, then Payroll. If the employee does not need to pay, use Waive."
      )
    }
    const recovery = await loadRecovery(tx, id)
    if (!recovery) throw new AppError(404, "Recovery not found")
    if (recovery.status === "WAIVED") {
      throw new AppError(409, "A waived recovery cannot be deducted from payroll.")
    }
    if (recovery.status === "RECOVERED") {
      const collected = collectedBy(recovery)
      throw new AppError(
        409,
        `This recovery was already collected${collected ? ` by ${collected}` : ""}.`,
        { recoveryId: id }
      )
    }
    if (recovery.adjustmentId) {
      throw new AppError(409, "This recovery is already being collected through payroll.")
    }

    const now = new Date()
    let adjustment: { id: string }
    try {
      adjustment = await tx.payrollAdjustment.create({
        data: {
          employeeId: recovery.employeeId,
          // The current month — the next run in progress picks the adjustment
          // up. The run itself refuses a closed or already-disbursed month.
          month: now.getUTCMonth() + 1,
          year: now.getUTCFullYear(),
          kind: "DEDUCTION",
          code: "ASSET_RECOVERY",
          label: `Asset recovery — ${recovery.asset?.assetTag ?? "asset"} ${recovery.asset?.name ?? ""}`,
          currency: recovery.currency,
          amount: recovery.amount,
          reason: recovery.reason,
          createdBy: actor.sub,
        },
      })
    } catch (err) {
      // The @unique on AssetRecovery.adjustmentId. Naming the constraint so a
      // second click reads as the guard, not as a server hiccup.
      if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
        throw new AppError(409, "This recovery is already being collected through payroll.")
      }
      throw err
    }

    const updated = await tx.assetRecovery.update({
      where: { id },
      data: { adjustmentId: adjustment.id },
    })

    await writeAudit(tx, {
      entity: "ASSET_RECOVERY",
      entityId: id,
      action: "PROCESS",
      changedBy: actor.sub,
      after: { adjustmentId: adjustment.id, status: "PENDING" },
    })

    return updated
  })
}

export { RECOVERY }
