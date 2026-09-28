import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import type { CreateVatCodeInput, UpdateVatCodeInput } from "./vatCode.validators"

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002"
}

/** Active codes only, unless `all` — a code someone turned off still needs
 *  to be listed to edit it back on, or to read on an old document that
 *  used it before it was turned off. */
export async function listVatCodes(query: { all?: boolean } = {}) {
  return prisma.vatCode.findMany({
    where: query.all ? undefined : { isActive: true },
    orderBy: { ratePercent: "desc" },
  })
}

export async function createVatCode(input: CreateVatCodeInput, actor: AccessTokenPayload) {
  try {
    return await prisma.$transaction(async (tx) => {
      const code = await tx.vatCode.create({
        data: { code: input.code, name: input.name, ratePercent: input.ratePercent },
      })
      await writeAudit(tx, {
        entity: "VAT_CODE", entityId: code.id, action: "CREATE", changedBy: actor.sub,
        after: { code: code.code, name: code.name, ratePercent: code.ratePercent.toString() },
      })
      return code
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, `A VAT code ${input.code} already exists.`)
    throw err
  }
}

/**
 * A new rate is used for new lines only (spec: "Approved invoices and
 * bills keep their VAT" — a line freezes its own vatAmount when written,
 * so this never touches a document that already exists).
 */
export async function updateVatCode(id: string, input: UpdateVatCodeInput, actor: AccessTokenPayload) {
  const existing = await prisma.vatCode.findUnique({ where: { id } })
  if (!existing) throw new AppError(404, "VAT code not found")

  const data: { name?: string; ratePercent?: string; isActive?: boolean } = {}
  if (input.name !== undefined) data.name = input.name
  if (input.ratePercent !== undefined) data.ratePercent = input.ratePercent
  if (input.isActive !== undefined) data.isActive = input.isActive

  return prisma.$transaction(async (tx) => {
    const updated = await tx.vatCode.update({ where: { id }, data })
    await writeAudit(tx, {
      entity: "VAT_CODE", entityId: id, action: "UPDATE", changedBy: actor.sub,
      before: { name: existing.name, ratePercent: existing.ratePercent.toString(), isActive: existing.isActive },
      after: { name: updated.name, ratePercent: updated.ratePercent.toString(), isActive: updated.isActive },
    })
    return updated
  })
}
