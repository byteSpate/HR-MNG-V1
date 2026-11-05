/**
 * The register: tags, CRUD, and the two irreversible lifecycle decisions.
 *
 * Custody lives in asset.assignments.ts; this file never writes an
 * AssetAssignment except through the guards that read one.
 */

import { z } from "zod"
import prisma from "../../config/prisma"
import type { AssetLifecycle, Prisma } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import { describeUsage } from "../../utils/referenceUsage"
import type { AccessTokenPayload } from "../auth/auth.types"
import { emitEvent } from "../event/event.emit"
import { dec, toMoneyString } from "../payroll/payroll.money"
import { assetScopeFor, canSeeCosts, stripCosts } from "./asset.access"
import { assetLifecycleEvent } from "./asset.events"
import { createRecoveryIn } from "./asset.recoveries"
import { computeAssetStatus } from "./asset.status"
import type { AssetStatus, HeldBy } from "./asset.types"
import type {
  CreateAssetInput,
  CreateCategoryInput,
  UpdateAssetInput,
  UpdateCategoryInput,
} from "./asset.validators"
import { lifecycleSchema } from "./asset.validators"

type LifecycleInput = z.infer<typeof lifecycleSchema>

/**
 * "BS-AST-00042", from the same IdCounter mechanism issuing employee codes.
 * Five digits, matching `createStaffAccount`'s padStart(5, "0") — a six-digit
 * asset tag beside a five-digit employee code reads as a different system.
 */
export async function nextAssetTag(tx: Prisma.TransactionClient): Promise<string> {
  const counter = await tx.idCounter.upsert({
    where: { id: "AST" },
    update: { value: { increment: 1 } },
    create: { id: "AST", value: 1 },
  })
  return `BS-AST-${String(counter.value).padStart(5, "0")}`
}

/**
 * `assetTag` and `serialNumber` are both unique. A clash is the person's
 * mistake, not ours, so it answers 409 with the field named, not a 500.
 * Caught around the transaction, as `createCategory` does.
 */
async function guardUnique<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      // Where Prisma puts the field name depends on the driver (`target` on
      // the engine, a constraint under `driverAdapterError` on the adapter),
      // so read the whole detail rather than one key.
      const target = JSON.stringify((err as { meta?: unknown }).meta ?? "")
      if (target.includes("serialNumber")) {
        throw new AppError(409, "Another asset already has this serial number. Check the number, then try again.")
      }
      if (target.includes("assetTag")) {
        throw new AppError(409, "Another asset already has this asset tag. Use a different tag.")
      }
      throw new AppError(409, "Another asset already has one of these values. Check the serial number and the tag.")
    }
    throw err
  }
}

async function requireDepartment(tx: Prisma.TransactionClient, departmentId: string | undefined) {
  if (!departmentId) return
  const department = await tx.department.findUnique({ where: { id: departmentId }, select: { id: true } })
  if (!department) throw new AppError(400, "This department was not found. Choose a department from the list.")
}

export async function createAsset(input: CreateAssetInput, actor: AccessTokenPayload) {
  return guardUnique(() => prisma.$transaction(async (tx) => {
    const category = await tx.assetCategory.findUnique({ where: { id: input.categoryId } })
    if (!category) throw new AppError(400, "Asset category not found")
    await requireDepartment(tx, input.departmentId)

    // Enforced at create rather than as a nullable field everyone forgets.
    if (category.requiresSerial && !input.serialNumber) {
      throw new AppError(400, `A serial number is required for ${category.name}`)
    }

    const assetTag = input.assetTag ?? (await nextAssetTag(tx))

    const asset = await tx.asset.create({
      data: {
        assetTag,
        categoryId: input.categoryId,
        name: input.name,
        serialNumber: input.serialNumber ?? null,
        model: input.model ?? null,
        notes: input.notes ?? null,
        purchaseDate: input.purchaseDate ? new Date(`${input.purchaseDate}T00:00:00.000Z`) : null,
        purchaseCost: input.purchaseCost !== undefined ? dec(input.purchaseCost) : null,
        currency: input.currency ?? "BDT",
        vendor: input.vendor ?? null,
        warrantyExpiry: input.warrantyExpiry
          ? new Date(`${input.warrantyExpiry}T00:00:00.000Z`)
          : null,
        departmentId: input.departmentId ?? null,
        location: input.location ?? null,
      },
    })

    await writeAudit(tx, {
      entity: "ASSET",
      entityId: asset.id,
      action: "CREATE",
      changedBy: actor.sub,
      after: { assetTag, name: input.name, categoryId: input.categoryId },
    })

    return asset
  }))
}

/**
 * Write-off. Refuses while somebody still has it — "take the asset back
 * before retiring it" — because retiring a held asset would silently orphan
 * the open assignment rather than close it.
 */
export async function retireAsset(
  id: string,
  body: LifecycleInput,
  actor: AccessTokenPayload
) {
  return prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUnique({ where: { id } })
    if (!asset) throw new AppError(404, "Asset not found")
    if (asset.lifecycle === "RETIRED") {
      throw new AppError(409, "This asset is already retired")
    }
    if (asset.lifecycle === "LOST") {
      throw new AppError(409, "This asset has already been marked lost")
    }

    const openAssignments = await tx.assetAssignment.count({
      where: { assetId: id, returnedAt: null },
    })
    if (openAssignments > 0) {
      throw new AppError(409, "Take the asset back before retiring it")
    }

    const updated = await tx.asset.update({
      where: { id },
      data: {
        lifecycle: "RETIRED",
        retiredAt: new Date(),
        retiredBy: actor.sub,
        retirementNote: body.note,
      },
    })

    await writeAudit(tx, {
      entity: "ASSET",
      entityId: id,
      action: "RETIRE",
      changedBy: actor.sub,
      before: { lifecycle: asset.lifecycle },
      after: { lifecycle: "RETIRED" },
      note: body.note,
    })

    await emitEvent(
      tx,
      assetLifecycleEvent({
        stage: "retired",
        assetId: id,
        assetTag: asset.assetTag,
        assetName: asset.name,
        note: body.note,
        actorUserId: actor.sub,
      })
    )

    return updated
  })
}

/**
 * A lost laptop is lost from somebody's desk. Deliberately does NOT check
 * for an open assignment — requiring a return first would mean fabricating a
 * handover that never happened.
 */
export async function markAssetLost(
  id: string,
  body: LifecycleInput,
  actor: AccessTokenPayload
) {
  return prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUnique({ where: { id } })
    if (!asset) throw new AppError(404, "Asset not found")
    if (asset.lifecycle === "RETIRED") {
      throw new AppError(409, "A retired asset cannot be marked lost")
    }
    if (asset.lifecycle === "LOST") {
      throw new AppError(409, "This asset is already marked lost")
    }

    const updated = await tx.asset.update({
      where: { id },
      data: {
        lifecycle: "LOST",
        retiredAt: new Date(),
        retiredBy: actor.sub,
        retirementNote: body.note,
      },
    })

    // Decision 4: the same dialog offers to price the recovery while the
    // circumstances are fresh. The debt is raised against whoever holds the
    // asset — an asset missing from the store room with nobody holding it is
    // a loss with no employee to recover from, so it is simply not priced.
    if (body.recovery) {
      const holder = await tx.assetAssignment.findFirst({
        where: { assetId: id, returnedAt: null },
        orderBy: { assignedAt: "desc" },
        select: { id: true, employeeId: true },
      })
      if (holder) {
        await createRecoveryIn(
          tx,
          {
            assetId: id,
            employeeId: holder.employeeId,
            assignmentId: holder.id,
            amount: body.recovery.amount,
            currency: body.recovery.currency,
            reason: body.recovery.reason,
            kind: body.recovery.kind ?? "LOST",
          },
          actor
        )
      }
    }

    await writeAudit(tx, {
      entity: "ASSET",
      entityId: id,
      action: "MARK_LOST",
      changedBy: actor.sub,
      before: { lifecycle: asset.lifecycle },
      after: { lifecycle: "LOST" },
      note: body.note,
    })

    await emitEvent(
      tx,
      assetLifecycleEvent({
        stage: "marked_lost",
        assetId: id,
        assetTag: asset.assetTag,
        assetName: asset.name,
        note: body.note,
        actorUserId: actor.sub,
      })
    )

    return updated
  })
}

/** Turns an open AssetAssignment row into the `HeldBy` shape `computeAssetStatus` wants. */
function heldByFrom(assignment: {
  id: string
  employeeId: string
  assignedAt: Date
  conditionOut: string
  acknowledgedAt: Date | null
  employee: { employeeCode: string; fullName: string }
}): HeldBy {
  return {
    assignmentId: assignment.id,
    employeeId: assignment.employeeId,
    employeeCode: assignment.employee.employeeCode,
    fullName: assignment.employee.fullName,
    assignedAt: assignment.assignedAt,
    conditionOut: assignment.conditionOut as HeldBy["conditionOut"],
    acknowledgedAt: assignment.acknowledgedAt,
  }
}

export interface AssetListFilters {
  categoryId?: string
  departmentId?: string
  lifecycle?: AssetLifecycle
  /** Matches against name, asset tag or serial number. */
  q?: string
  /** Derived status — filtered after the fetch, see listAssets. */
  status?: AssetStatus
}

/**
 * Scoped by `assetScopeFor`, with each row's status derived — never stored —
 * from whether an open assignment or open repair exists.
 */
export async function listAssets(viewer: AccessTokenPayload, filters: AssetListFilters = {}) {
  const scope = await assetScopeFor(viewer)

  const where: Prisma.AssetWhereInput = {
    ...scope,
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    ...(filters.lifecycle ? { lifecycle: filters.lifecycle } : {}),
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: "insensitive" as const } },
            { assetTag: { contains: filters.q, mode: "insensitive" as const } },
            { serialNumber: { contains: filters.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  }

  const assets = await prisma.asset.findMany({
    where,
    include: {
      category: true,
      assignments: {
        where: { returnedAt: null },
        take: 1,
        include: { employee: { select: { employeeCode: true, fullName: true } } },
      },
      repairs: { where: { returnedAt: null }, take: 1, select: { id: true } },
    },
    orderBy: { assetTag: "asc" },
  })

  // Cost-visible roles need to know whether an asset's payable has been
  // cleared, which is a fact about the ledger, not the register. One batch
  // lookup across the page's assets rather than a query per row.
  const paidIds = canSeeCosts(viewer.role)
    ? new Set(
        (
          await prisma.journal.findMany({
            where: { sourceModule: "ASSET", sourceEvent: "PAYMENT", sourceRefId: { in: assets.map((a) => a.id) } },
            select: { sourceRefId: true },
          })
        ).map((j) => j.sourceRefId!)
      )
    : new Set<string>()

  const presented = assets.map(({ assignments, repairs, ...asset }) => {
    const openAssignment = assignments[0] ?? null
    const { status, heldBy } = computeAssetStatus({
      lifecycle: asset.lifecycle,
      openAssignment: openAssignment ? heldByFrom(openAssignment) : null,
      hasOpenRepair: repairs.length > 0,
    })
    const withCosts = canSeeCosts(viewer.role)
      ? { ...asset, status, heldBy, paid: paidIds.has(asset.id) }
      : { ...asset, status, heldBy }
    return stripCosts(withCosts, viewer.role)
  })

  // EC-1: status is derived, so it filters after the fetch. lifecycle is
  // stored and stays in the WHERE clause above. The parameter used to be
  // parsed, validated and then silently dropped.
  return filters.status ? presented.filter((a) => a.status === filters.status) : presented
}

/**
 * 404s — never 403s — when the id falls outside the caller's scope, so an
 * employee probing ids learns nothing about what exists.
 */
export async function getAsset(id: string, viewer: AccessTokenPayload) {
  const scope = await assetScopeFor(viewer)

  const asset = await prisma.asset.findFirst({
    where: { AND: [{ id }, scope] },
    include: {
      category: true,
      department: true,
      assignments: {
        orderBy: { assignedAt: "desc" },
        include: { employee: { select: { employeeCode: true, fullName: true } } },
      },
      repairs: { orderBy: { sentAt: "desc" } },
      attachments: true,
    },
  })
  if (!asset) throw new AppError(404, "Asset not found")

  const openAssignment = asset.assignments.find((a) => a.returnedAt === null) ?? null
  const hasOpenRepair = asset.repairs.some((r) => r.returnedAt === null)

  const { status, heldBy } = computeAssetStatus({
    lifecycle: asset.lifecycle,
    openAssignment: openAssignment ? heldByFrom(openAssignment) : null,
    hasOpenRepair,
  })

  return stripCosts({ ...asset, status, heldBy }, viewer.role)
}

/** Only the fields that actually changed land in the update and the audit row. */
export async function updateAsset(
  id: string,
  input: UpdateAssetInput,
  actor: AccessTokenPayload
) {
  return guardUnique(() => prisma.$transaction(async (tx) => {
    const existing = await tx.asset.findUnique({ where: { id } })
    if (!existing) throw new AppError(404, "Asset not found")

    if (input.departmentId && input.departmentId !== existing.departmentId) {
      await requireDepartment(tx, input.departmentId)
    }

    if (input.categoryId && input.categoryId !== existing.categoryId) {
      const category = await tx.assetCategory.findUnique({ where: { id: input.categoryId } })
      if (!category) throw new AppError(400, "Asset category not found")
      const effectiveSerial =
        input.serialNumber !== undefined ? input.serialNumber : existing.serialNumber
      if (category.requiresSerial && !effectiveSerial) {
        throw new AppError(409, `A serial number is required for ${category.name}`)
      }
    }

    const data: Prisma.AssetUpdateInput = {}
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}

    if (input.categoryId !== undefined && input.categoryId !== existing.categoryId) {
      before.categoryId = existing.categoryId
      after.categoryId = input.categoryId
      data.category = { connect: { id: input.categoryId } }
    }
    if (input.name !== undefined && input.name !== existing.name) {
      before.name = existing.name
      after.name = input.name
      data.name = input.name
    }
    if (input.assetTag !== undefined && input.assetTag !== existing.assetTag) {
      before.assetTag = existing.assetTag
      after.assetTag = input.assetTag
      data.assetTag = input.assetTag
    }
    if (input.serialNumber !== undefined && input.serialNumber !== existing.serialNumber) {
      before.serialNumber = existing.serialNumber
      after.serialNumber = input.serialNumber
      data.serialNumber = input.serialNumber
    }
    if (input.model !== undefined && input.model !== existing.model) {
      before.model = existing.model
      after.model = input.model
      data.model = input.model
    }
    if (input.notes !== undefined && input.notes !== existing.notes) {
      before.notes = existing.notes
      after.notes = input.notes
      data.notes = input.notes
    }
    if (input.purchaseDate !== undefined) {
      const oldIso = existing.purchaseDate ? existing.purchaseDate.toISOString().slice(0, 10) : null
      if (input.purchaseDate !== oldIso) {
        before.purchaseDate = oldIso
        after.purchaseDate = input.purchaseDate
        data.purchaseDate = new Date(`${input.purchaseDate}T00:00:00.000Z`)
      }
    }
    if (input.purchaseCost !== undefined) {
      const newCost = dec(input.purchaseCost)
      if (!existing.purchaseCost || !newCost.equals(existing.purchaseCost)) {
        before.purchaseCost = existing.purchaseCost ? toMoneyString(existing.purchaseCost) : null
        after.purchaseCost = toMoneyString(newCost)
        data.purchaseCost = newCost
      }
    }
    if (input.currency !== undefined && input.currency !== existing.currency) {
      before.currency = existing.currency
      after.currency = input.currency
      data.currency = input.currency
    }
    if (input.vendor !== undefined && input.vendor !== existing.vendor) {
      before.vendor = existing.vendor
      after.vendor = input.vendor
      data.vendor = input.vendor
    }
    if (input.warrantyExpiry !== undefined) {
      const oldIso = existing.warrantyExpiry
        ? existing.warrantyExpiry.toISOString().slice(0, 10)
        : null
      if (input.warrantyExpiry !== oldIso) {
        before.warrantyExpiry = oldIso
        after.warrantyExpiry = input.warrantyExpiry
        // `null` clears the date.
        data.warrantyExpiry =
          input.warrantyExpiry === null ? null : new Date(`${input.warrantyExpiry}T00:00:00.000Z`)
      }
    }
    if (input.departmentId !== undefined && input.departmentId !== existing.departmentId) {
      before.departmentId = existing.departmentId
      after.departmentId = input.departmentId
      data.department = { connect: { id: input.departmentId } }
    }
    if (input.location !== undefined && input.location !== existing.location) {
      before.location = existing.location
      after.location = input.location
      data.location = input.location
    }

    // Nothing actually changed — not a mutation, so no update and no audit row.
    if (Object.keys(data).length === 0) return existing

    const updated = await tx.asset.update({ where: { id }, data })

    await writeAudit(tx, {
      entity: "ASSET",
      entityId: id,
      action: "UPDATE",
      changedBy: actor.sub,
      before: before as Prisma.InputJsonValue,
      after: after as Prisma.InputJsonValue,
    })

    return updated
  }))
}

export async function listCategories() {
  return prisma.assetCategory.findMany({ orderBy: { name: "asc" } })
}

export async function createCategory(input: CreateCategoryInput, actor: AccessTokenPayload) {
  try {
    return await prisma.$transaction(async (tx) => {
      const category = await tx.assetCategory.create({
        data: {
          code: input.code,
          name: input.name,
          requiresSerial: input.requiresSerial ?? true,
          isConsumable: input.isConsumable ?? false,
          usefulLifeMonths: input.usefulLifeMonths ?? null,
          classification: input.classification,
        },
      })

      await writeAudit(tx, {
        entity: "ASSET_CATEGORY",
        entityId: category.id,
        action: "CREATE",
        changedBy: actor.sub,
        after: { code: category.code, name: category.name },
      })

      return category
    })
  } catch (err) {
    // Unique violation on `code` or `name` — caught around the transaction,
    // not inside it, matching `createStaffAccount`.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      throw new AppError(409, "A category with this code or name already exists")
    }
    throw err
  }
}

/**
 * No deactivate: a category is either in use, in which case `deleteCategory`
 * refuses, or it is not, in which case deleting it outright is cleaner than
 * leaving a retired row in every picker forever.
 */
export async function updateCategory(
  id: string,
  input: UpdateCategoryInput,
  actor: AccessTokenPayload
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.assetCategory.findUnique({ where: { id } })
    if (!existing) throw new AppError(404, "Asset category not found")

    // Flipping requiresSerial on would silently make every serial-less asset
    // already in this category invalid — refuse rather than let the register
    // drift out of the rule it now claims to enforce.
    if (input.requiresSerial === true && !existing.requiresSerial) {
      const missingSerial = await tx.asset.count({
        where: { categoryId: id, serialNumber: null },
      })
      if (missingSerial > 0) {
        throw new AppError(
          409,
          `${missingSerial} asset(s) in this category have no serial number`
        )
      }
    }

    // Mirrors the requiresSerial guard. A category that already has registered
    // assets cannot retroactively become a supply — those rows have tags,
    // custody and history that a supply has no room for.
    if (input.tracksIndividually === false && existing.tracksIndividually) {
      const registered = await tx.asset.count({ where: { categoryId: id } })
      if (registered > 0) {
        throw new AppError(
          409,
          `${registered} asset(s) are already registered in this category, so it cannot become a supply.`
        )
      }
    }

    const data: Prisma.AssetCategoryUpdateInput = {}
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}

    if (input.name !== undefined && input.name !== existing.name) {
      before.name = existing.name
      after.name = input.name
      data.name = input.name
    }
    if (input.requiresSerial !== undefined && input.requiresSerial !== existing.requiresSerial) {
      before.requiresSerial = existing.requiresSerial
      after.requiresSerial = input.requiresSerial
      data.requiresSerial = input.requiresSerial
    }
    if (input.isConsumable !== undefined && input.isConsumable !== existing.isConsumable) {
      before.isConsumable = existing.isConsumable
      after.isConsumable = input.isConsumable
      data.isConsumable = input.isConsumable
    }
    if (
      input.usefulLifeMonths !== undefined &&
      input.usefulLifeMonths !== existing.usefulLifeMonths
    ) {
      before.usefulLifeMonths = existing.usefulLifeMonths
      after.usefulLifeMonths = input.usefulLifeMonths
      data.usefulLifeMonths = input.usefulLifeMonths
    }
    if (
      input.classification !== undefined &&
      input.classification !== existing.classification
    ) {
      before.classification = existing.classification
      after.classification = input.classification
      data.classification = input.classification
    }
    if (
      input.tracksIndividually !== undefined &&
      input.tracksIndividually !== existing.tracksIndividually
    ) {
      before.tracksIndividually = existing.tracksIndividually
      after.tracksIndividually = input.tracksIndividually
      data.tracksIndividually = input.tracksIndividually
    }

    if (Object.keys(data).length === 0) return existing

    const updated = await tx.assetCategory.update({ where: { id }, data })

    await writeAudit(tx, {
      entity: "ASSET_CATEGORY",
      entityId: id,
      action: "UPDATE",
      changedBy: actor.sub,
      before: before as Prisma.InputJsonValue,
      after: after as Prisma.InputJsonValue,
    })

    return updated
  })
}

export async function deleteCategory(id: string, actor: AccessTokenPayload): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.assetCategory.findUnique({ where: { id } })
    if (!existing) throw new AppError(404, "Asset category not found")

    // Both relations are required, so the database would refuse this anyway —
    // but as a P2003 the error middleware renders as a 500. Counting first
    // turns that into a 409 that says what to do about it.
    const [assets, requests] = await Promise.all([
      tx.asset.count({ where: { categoryId: id } }),
      tx.assetRequest.count({ where: { categoryId: id } }),
    ])

    const usage = describeUsage([
      { noun: "asset", count: assets },
      { noun: "request", count: requests },
    ])
    if (usage !== null) {
      throw new AppError(409, `This category is still in use by ${usage}. Reassign them first.`)
    }

    await tx.assetCategory.delete({ where: { id } })

    await writeAudit(tx, {
      entity: "ASSET_CATEGORY",
      entityId: id,
      action: "DELETE",
      changedBy: actor.sub,
      before: { code: existing.code, name: existing.name },
    })
  })
}
