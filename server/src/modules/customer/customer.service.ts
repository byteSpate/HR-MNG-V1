/**
 * Customer master data.
 *
 * A Sales Account becomes a Customer the day its first Opportunity is Won
 * (design §2) — that hook is Phase 3, wired from the Sales Hub, not here.
 * This module only covers the record itself, created by hand for now.
 */

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import type { CreateCustomerInput, UpdateCustomerInput } from "./customer.validators"

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002"
}

export async function listCustomers() {
  return prisma.customer.findMany({
    select: {
      id: true, legalName: true, billingAddress: true, bin: true,
      paymentDays: true, salesAccountId: true, createdAt: true,
    },
    orderBy: { legalName: "asc" },
  })
}

export async function getCustomer(id: string) {
  const customer = await prisma.customer.findUnique({ where: { id } })
  if (!customer) throw new AppError(404, "Customer not found")
  return customer
}

export async function createCustomer(input: CreateCustomerInput, actor: AccessTokenPayload) {
  try {
    return await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          legalName: input.legalName,
          billingAddress: input.billingAddress ?? null,
          bin: input.bin ?? null,
          paymentDays: input.paymentDays ?? 30,
          salesAccountId: input.salesAccountId ?? null,
        },
      })

      await writeAudit(tx, {
        entity: "CUSTOMER",
        entityId: customer.id,
        action: "CREATE",
        changedBy: actor.sub,
        after: { legalName: customer.legalName, bin: customer.bin, paymentDays: customer.paymentDays },
      })

      return customer
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, "A customer with this legal name already exists")
    throw err
  }
}

export async function updateCustomer(
  id: string,
  input: UpdateCustomerInput,
  actor: AccessTokenPayload
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.customer.findUnique({ where: { id } })
      if (!existing) throw new AppError(404, "Customer not found")

      const customer = await tx.customer.update({
        where: { id },
        data: {
          legalName: input.legalName,
          billingAddress: input.billingAddress ?? null,
          bin: input.bin ?? null,
          paymentDays: input.paymentDays ?? existing.paymentDays,
        },
      })

      await writeAudit(tx, {
        entity: "CUSTOMER",
        entityId: id,
        action: "UPDATE",
        changedBy: actor.sub,
        before: { legalName: existing.legalName, bin: existing.bin, paymentDays: existing.paymentDays },
        after: { legalName: customer.legalName, bin: customer.bin, paymentDays: customer.paymentDays },
      })

      return customer
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, "A customer with this legal name already exists")
    throw err
  }
}
