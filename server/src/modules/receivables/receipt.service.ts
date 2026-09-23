import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import { assertOpeningReceivable, assertReceivable } from "./receipt.allocation"
import type { CertificatesInput, CreateReceiptInput } from "./receipt.validators"

const ZERO = new Prisma.Decimal(0)

export const RECEIPT_INCLUDE = {
  customer: { select: { id: true, legalName: true } },
  allocations: { include: { invoice: { select: { id: true, invoiceNumber: true } } } },
  openingAllocations: true,
} satisfies Prisma.ReceiptInclude

/** Settled (cash plus tax withheld), allocated (invoices plus the opening
 *  balance, upfront allocations only), and the advance left over. */
export function receiptPosition(r: {
  amount: Prisma.Decimal
  vdsAmount: Prisma.Decimal
  aitAmount: Prisma.Decimal
  allocations: Array<{ amount: Prisma.Decimal }>
  openingAllocations: Array<{ amount: Prisma.Decimal }>
}) {
  const settled = new Prisma.Decimal(r.amount).plus(r.vdsAmount).plus(r.aitAmount)
  const allocated = [...r.allocations, ...r.openingAllocations].reduce((s, a) => s.plus(a.amount), ZERO)
  return { settled, allocated, advance: settled.minus(allocated) }
}

function assertCertificates(input: {
  vdsAmount?: string; vdsCertificateRef?: string; vdsCertificateDate?: string
  aitAmount?: string; aitCertificateRef?: string; aitCertificateDate?: string
}) {
  const checks: Array<["VDS" | "AIT", string, string | undefined, string | undefined]> = [
    ["VDS", input.vdsAmount ?? "0", input.vdsCertificateRef, input.vdsCertificateDate],
    ["AIT", input.aitAmount ?? "0", input.aitCertificateRef, input.aitCertificateDate],
  ]
  for (const [label, amount, ref, date] of checks) {
    if (Boolean(ref) !== Boolean(date)) {
      throw new AppError(400, `Give the ${label} certificate's number and date together`)
    }
    if (ref && new Prisma.Decimal(amount).isZero()) {
      throw new AppError(400, `This receipt has no ${label === "VDS" ? "VAT" : "income tax"} withheld, so it has no ${label} certificate`)
    }
  }
}

export async function createReceipt(input: CreateReceiptInput, actor: AccessTokenPayload) {
  assertCertificates(input)

  const amount = new Prisma.Decimal(input.amount)
  const vds = new Prisma.Decimal(input.vdsAmount ?? "0")
  const ait = new Prisma.Decimal(input.aitAmount ?? "0")
  const allocations = (input.allocations ?? []).map((a) => ({ invoiceId: a.invoiceId, amount: new Prisma.Decimal(a.amount) }))
  const opening = input.openingAllocation ? new Prisma.Decimal(input.openingAllocation.amount) : null

  const { settled, allocated } = receiptPosition({
    amount, vdsAmount: vds, aitAmount: ait, allocations,
    openingAllocations: opening ? [{ amount: opening }] : [],
  })
  if (allocated.greaterThan(settled)) {
    throw new AppError(400, `Allocations cannot add up to more than this receipt settles, ${settled.toFixed(2)} with the tax withheld`)
  }
  const withheld = vds.plus(ait)
  if (allocated.lessThan(withheld)) {
    throw new AppError(
      400,
      `Tax withheld is always withheld from an invoice. Allocate at least ${withheld.toFixed(2)} of this receipt to invoices or the opening balance.`
    )
  }

  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: input.customerId } })
    if (!customer) throw new AppError(404, "Customer not found")

    await assertReceivable(tx, customer.id, allocations)
    const openingRow = opening ? { ...(await assertOpeningReceivable(tx, customer.id, opening)), amount: opening.toFixed(2) } : null

    const receipt = await tx.receipt.create({
      data: {
        customerId: customer.id,
        date: new Date(input.date),
        amount: amount.toFixed(2),
        vdsAmount: vds.toFixed(2),
        vdsCertificateRef: input.vdsCertificateRef ?? null,
        vdsCertificateDate: input.vdsCertificateDate ? new Date(input.vdsCertificateDate) : null,
        aitAmount: ait.toFixed(2),
        aitCertificateRef: input.aitCertificateRef ?? null,
        aitCertificateDate: input.aitCertificateDate ? new Date(input.aitCertificateDate) : null,
        reference: input.reference ?? null,
        createdBy: actor.sub,
        allocations: { create: allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount.toFixed(2) })) },
        ...(openingRow ? { openingAllocations: { create: [openingRow] } } : {}),
      },
      include: RECEIPT_INCLUDE,
    })
    await writeAudit(tx, {
      entity: "RECEIPT", entityId: receipt.id, action: "CREATE", changedBy: actor.sub,
      after: { amount: receipt.amount, vdsAmount: receipt.vdsAmount, aitAmount: receipt.aitAmount },
    })
    return receipt
  })
}

export async function listReceipts(filter: { status?: "DRAFT" | "APPROVED"; certificates?: "missing" }) {
  const where =
    filter.certificates === "missing"
      ? {
          status: "APPROVED" as const,
          OR: [
            { vdsAmount: { gt: 0 }, vdsCertificateRef: null },
            { aitAmount: { gt: 0 }, aitCertificateRef: null },
          ],
        }
      : { status: filter.status }
  return prisma.receipt.findMany({ where, include: RECEIPT_INCLUDE, orderBy: { date: "desc" } })
}

/**
 * Withholding certificates arrive days after a receipt is approved (spec
 * §2: three working days for a Mushak 6.6), so they are recorded onto a
 * receipt of any status, never blocked on it still being a draft. A field
 * left out of `input` keeps its current value; sent as `null` it clears.
 */
export async function updateReceiptCertificates(id: string, input: CertificatesInput, actor: AccessTokenPayload) {
  const receipt = await prisma.receipt.findUnique({ where: { id } })
  if (!receipt) throw new AppError(404, "Receipt not found")

  const merged = {
    vdsAmount: receipt.vdsAmount,
    vdsCertificateRef: "vdsCertificateRef" in input ? input.vdsCertificateRef ?? null : receipt.vdsCertificateRef,
    vdsCertificateDate: "vdsCertificateDate" in input ? (input.vdsCertificateDate ? new Date(input.vdsCertificateDate) : null) : receipt.vdsCertificateDate,
    aitAmount: receipt.aitAmount,
    aitCertificateRef: "aitCertificateRef" in input ? input.aitCertificateRef ?? null : receipt.aitCertificateRef,
    aitCertificateDate: "aitCertificateDate" in input ? (input.aitCertificateDate ? new Date(input.aitCertificateDate) : null) : receipt.aitCertificateDate,
  }
  for (const [label, amount, ref, date] of [
    ["VDS", merged.vdsAmount, merged.vdsCertificateRef, merged.vdsCertificateDate],
    ["AIT", merged.aitAmount, merged.aitCertificateRef, merged.aitCertificateDate],
  ] as const) {
    if (Boolean(ref) !== Boolean(date)) throw new AppError(400, `Give the ${label} certificate's number and date together`)
    if (ref && new Prisma.Decimal(amount).isZero()) {
      throw new AppError(400, `This receipt has no ${label === "VDS" ? "VAT" : "income tax"} withheld, so it has no ${label} certificate`)
    }
  }

  const data: Record<string, unknown> = {}
  if ("vdsCertificateRef" in input) data.vdsCertificateRef = merged.vdsCertificateRef
  if ("vdsCertificateDate" in input) data.vdsCertificateDate = merged.vdsCertificateDate
  if ("aitCertificateRef" in input) data.aitCertificateRef = merged.aitCertificateRef
  if ("aitCertificateDate" in input) data.aitCertificateDate = merged.aitCertificateDate

  return prisma.$transaction(async (tx) => {
    const updated = await tx.receipt.update({ where: { id }, data, include: RECEIPT_INCLUDE })
    await writeAudit(tx, {
      entity: "RECEIPT", entityId: id, action: "UPDATE", changedBy: actor.sub,
      after: data as Prisma.InputJsonObject, note: "Withholding certificate recorded",
    })
    return updated
  })
}

export async function getReceipt(id: string) {
  const receipt = await prisma.receipt.findUnique({ where: { id }, include: RECEIPT_INCLUDE })
  if (!receipt) throw new AppError(404, "Receipt not found")
  return receipt
}
