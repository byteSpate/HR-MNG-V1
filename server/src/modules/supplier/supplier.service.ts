/**
 * Supplier master data — Star Tech, Smart Technologies, and every other
 * company ByteSpate buys from for a deal.
 *
 * Deactivated, never hard-deleted, once a supplier carries a bill — same
 * posture as Account and AssetCategory. `isActive: false` hides it from new
 * bill entry without touching its history.
 */

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import type { CreateSupplierInput, UpdateSupplierInput } from "./supplier.validators"

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002"
}

export async function listSuppliers() {
  return prisma.supplier.findMany({
    select: {
      id: true, name: true, contactName: true, contactPhone: true, contactEmail: true,
      bin: true, paymentDays: true, isActive: true, createdAt: true,
    },
    orderBy: { name: "asc" },
  })
}

export async function getSupplier(id: string) {
  const supplier = await prisma.supplier.findUnique({ where: { id } })
  if (!supplier) throw new AppError(404, "Supplier not found")
  return supplier
}

export async function createSupplier(input: CreateSupplierInput, actor: AccessTokenPayload) {
  try {
    return await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.create({
        data: {
          name: input.name,
          contactName: input.contactName ?? null,
          contactPhone: input.contactPhone ?? null,
          contactEmail: input.contactEmail ?? null,
          bin: input.bin ?? null,
          paymentDays: input.paymentDays ?? 30,
        },
      })

      await writeAudit(tx, {
        entity: "SUPPLIER",
        entityId: supplier.id,
        action: "CREATE",
        changedBy: actor.sub,
        after: { name: supplier.name, bin: supplier.bin, paymentDays: supplier.paymentDays },
      })

      return supplier
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, "A supplier with this name already exists")
    throw err
  }
}

export async function updateSupplier(
  id: string,
  input: UpdateSupplierInput,
  actor: AccessTokenPayload
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.supplier.findUnique({ where: { id } })
      if (!existing) throw new AppError(404, "Supplier not found")

      const supplier = await tx.supplier.update({
        where: { id },
        data: {
          name: input.name,
          contactName: input.contactName ?? null,
          contactPhone: input.contactPhone ?? null,
          contactEmail: input.contactEmail ?? null,
          bin: input.bin ?? null,
          paymentDays: input.paymentDays ?? existing.paymentDays,
        },
      })

      await writeAudit(tx, {
        entity: "SUPPLIER",
        entityId: id,
        action: "UPDATE",
        changedBy: actor.sub,
        before: { name: existing.name, bin: existing.bin },
        after: { name: supplier.name, bin: supplier.bin },
      })

      return supplier
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, "A supplier with this name already exists")
    throw err
  }
}

export async function deactivateSupplier(id: string, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.supplier.findUnique({ where: { id } })
    if (!existing) throw new AppError(404, "Supplier not found")

    const supplier = await tx.supplier.update({ where: { id }, data: { isActive: false } })

    await writeAudit(tx, {
      entity: "SUPPLIER",
      entityId: id,
      action: "UPDATE",
      changedBy: actor.sub,
      before: { isActive: true },
      after: { isActive: false },
    })

    return supplier
  })
}
