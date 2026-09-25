import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import type { AccessTokenPayload } from "../auth/auth.types"

/** Lower-case, letters and digits only — must match the migration SQL's
 *  regexp_replace(lower(name), '[^a-z0-9]', '', 'g') exactly, so "Star
 *  Tech" and "StarTech" are the same supplier. */
export function supplierNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "")
}

/**
 * Adds a supplier by name only, from the Sales Hub product line form. No
 * transaction and no audit row: this is a lightweight convenience during
 * data entry, distinct from the full create (supplier.service.ts), which
 * still owns contact details, BIN and the audit trail.
 */
export async function quickAddSupplier(input: { name: string }, _actor: AccessTokenPayload): Promise<{ id: string; name: string }> {
  const name = input.name.trim()
  const nameKey = supplierNameKey(name)
  const existing = await prisma.supplier.findUnique({ where: { nameKey } })
  if (existing) throw new AppError(409, `${existing.name} is already a supplier. Pick it from the list.`)

  const supplier = await prisma.supplier.create({ data: { name, nameKey } })
  return { id: supplier.id, name: supplier.name }
}

/** "Did you mean?" while typing a new supplier's name. */
export async function findSimilarSuppliers(q: string): Promise<Array<{ id: string; name: string }>> {
  const key = supplierNameKey(q)
  if (!key) return []
  return prisma.supplier.findMany({
    where: { nameKey: { contains: key } },
    select: { id: true, name: true },
    take: 5,
  })
}

export async function listSupplierOptions(): Promise<Array<{ id: string; name: string }>> {
  return prisma.supplier.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
}
