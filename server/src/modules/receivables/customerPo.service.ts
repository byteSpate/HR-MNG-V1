import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import { ensureCustomerForAccount } from "../customer/customer.link"
import type { AccessTokenPayload } from "../auth/auth.types"
import { assertDealAccess, isFinance } from "./receivables.access"
import { loadActiveVatRates } from "./receivables.vat"
import {
  assertLineKinds,
  type CancelCustomerPoInput,
  type CreateCustomerPoInput,
  type UpdateCustomerPoInput,
} from "./customerPo.validators"

const ZERO = new Prisma.Decimal(0)
const LOCKED = "This PO already has an invoice, so it can no longer be edited or cancelled. Raise a credit note on the invoice instead."

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002"
}

export const PO_INCLUDE = {
  customer: { select: { id: true, legalName: true } },
  opportunity: { select: { id: true, serial: true, name: true } },
  lines: {
    orderBy: { order: "asc" },
    include: {
      vatCode: true,
      invoiceLines: { where: { invoice: { status: { in: ["DRAFT", "APPROVED"] } } }, select: { amount: true } },
      earningLines: { where: { event: { status: "APPROVED" } }, select: { amount: true, quantity: true } },
      monthlyEarnings: { where: { run: { status: "POSTED" } }, select: { amount: true } },
    },
  },
  schedule: { orderBy: { order: "asc" } },
} satisfies Prisma.CustomerPoInclude

/** Net left to invoice on a PO line: its amount less every draft or
 *  approved invoice line. Never negative in practice (Task 10 checks this
 *  at approval), but the caller decides what to do with a negative result. */
export function poLineRemaining(line: { amount: Prisma.Decimal; invoiceLines: Array<{ amount: Prisma.Decimal }> }): Prisma.Decimal {
  return line.invoiceLines.reduce((left, l) => left.minus(l.amount), new Prisma.Decimal(line.amount))
}

async function nextPoSerial(tx: Prisma.TransactionClient): Promise<string> {
  const counter = await tx.idCounter.upsert({
    where: { id: "CPO" },
    update: { value: { increment: 1 } },
    create: { id: "CPO", value: 1 },
  })
  return `BS-CPO-${String(counter.value).padStart(5, "0")}`
}

export interface PrefillLine {
  description: string
  kind: "GOODS"
  quantity: string
  unitPrice: string | null
}

/** Copied from the Opportunity's own Line Items by a button the client
 *  presses — never silently, the same rule the Sales Hub already holds
 *  itself to. A blank unit price is left blank: a price worked out from a
 *  line total nobody actually split per unit would be invented, not read. */
export async function prefillPoLines(opportunityId: string, actor: AccessTokenPayload): Promise<{ lines: PrefillLine[] }> {
  await assertDealAccess(prisma, actor, opportunityId)
  const products = await prisma.opportunityLine.findMany({ where: { opportunityId }, orderBy: { order: "asc" } })
  return {
    lines: products.map((p) => ({
      description: [p.product, p.oemBrand, p.model].filter(Boolean).join(" "),
      kind: "GOODS" as const,
      quantity: String(p.quantity ?? 1),
      unitPrice: p.unitValue ? new Prisma.Decimal(p.unitValue).toFixed(2) : null,
    })),
  }
}

function lineRows(lines: CreateCustomerPoInput["lines"]) {
  return lines.map((l, i) => ({
    description: l.description.trim(),
    kind: l.kind,
    quantity: new Prisma.Decimal(l.quantity).toFixed(2),
    unitPrice: new Prisma.Decimal(l.unitPrice).toFixed(2),
    amount: new Prisma.Decimal(l.quantity).times(l.unitPrice).toFixed(2),
    vatCodeId: l.vatCodeId,
    earnKind: l.earnKind ?? null,
    contractStart: l.contractStart ? new Date(l.contractStart) : null,
    contractEnd: l.contractEnd ? new Date(l.contractEnd) : null,
    order: i,
  }))
}

function scheduleRows(schedule: CreateCustomerPoInput["schedule"], lines: ReturnType<typeof lineRows>) {
  const net = lines.reduce((s, r) => s.plus(r.amount), ZERO)
  const planned = schedule.reduce((s, r) => s.plus(r.amount), ZERO)
  if (planned.greaterThan(net)) {
    throw new AppError(400, `The billing schedule adds up to ${planned.toFixed(2)}, more than the PO's ${net.toFixed(2)} before VAT`)
  }
  return schedule.map((s, i) => ({
    plannedDate: new Date(s.plannedDate),
    amount: new Prisma.Decimal(s.amount).toFixed(2),
    note: s.note?.trim() || null,
    order: i,
  }))
}

export async function createCustomerPo(input: CreateCustomerPoInput, actor: AccessTokenPayload) {
  try {
    return await prisma.$transaction(async (tx) => {
      const deal = await assertDealAccess(tx, actor, input.opportunityId)
      if (deal.status !== "WON") throw new AppError(400, `${deal.serial} is not a Won deal, so it cannot have a customer PO yet`)

      const customer = await ensureCustomerForAccount(tx, deal.salesAccountId, "throw-on-conflict", actor.sub)
      await loadActiveVatRates(tx, input.lines.map((l) => l.vatCodeId))

      const lines = lineRows(input.lines)
      const schedule = scheduleRows(input.schedule, lines)

      const po = await tx.customerPo.create({
        data: {
          serial: await nextPoSerial(tx),
          opportunityId: deal.id,
          customerId: customer!.id,
          customerPoNumber: input.customerPoNumber.trim(),
          date: new Date(input.date),
          invoiceTo: input.invoiceTo?.trim() || null,
          trackDelivery: input.trackDelivery,
          createdBy: actor.sub,
          lines: { create: lines },
          schedule: { create: schedule },
        },
        include: PO_INCLUDE,
      })
      await writeAudit(tx, {
        entity: "CUSTOMER_PO", entityId: po.id, action: "CREATE", changedBy: actor.sub,
        after: { serial: po.serial, customerPoNumber: po.customerPoNumber },
      })
      return po
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(409, `This customer already has a PO numbered ${input.customerPoNumber.trim()}`)
    }
    throw err
  }
}

async function loadEditable(tx: Prisma.TransactionClient, id: string, actor: AccessTokenPayload) {
  const po = await tx.customerPo.findUnique({ where: { id }, include: { _count: { select: { invoices: true } } } })
  if (!po) throw new AppError(404, "Customer PO not found")
  await assertDealAccess(tx, actor, po.opportunityId)
  if (po._count.invoices > 0) throw new AppError(409, LOCKED)
  return po
}

export async function updateCustomerPo(id: string, input: UpdateCustomerPoInput, actor: AccessTokenPayload) {
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await loadEditable(tx, id, actor)
      if (existing.status !== "OPEN") throw new AppError(409, "Only an open PO can be edited")

      const kindMessage = assertLineKinds(existing.trackDelivery, input.lines)
      if (kindMessage) throw new AppError(400, kindMessage)

      await loadActiveVatRates(tx, input.lines.map((l) => l.vatCodeId))
      const lines = lineRows(input.lines)
      const schedule = scheduleRows(input.schedule, lines)

      await tx.customerPoLine.deleteMany({ where: { poId: id } })
      await tx.billingScheduleRow.deleteMany({ where: { poId: id } })

      const po = await tx.customerPo.update({
        where: { id },
        data: {
          customerPoNumber: input.customerPoNumber.trim(),
          date: new Date(input.date),
          invoiceTo: input.invoiceTo?.trim() || null,
          lines: { create: lines },
          schedule: { create: schedule },
        },
        include: PO_INCLUDE,
      })
      await writeAudit(tx, { entity: "CUSTOMER_PO", entityId: id, action: "UPDATE", changedBy: actor.sub })
      return po
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(409, `This customer already has a PO numbered ${input.customerPoNumber.trim()}`)
    }
    throw err
  }
}

export async function cancelCustomerPo(id: string, input: CancelCustomerPoInput, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    const existing = await loadEditable(tx, id, actor)
    if (existing.status !== "OPEN") throw new AppError(409, "Only an open PO can be cancelled")

    const po = await tx.customerPo.update({
      where: { id },
      data: { status: "CANCELLED", cancelReason: input.reason.trim() },
      include: PO_INCLUDE,
    })
    await writeAudit(tx, {
      entity: "CUSTOMER_PO", entityId: id, action: "UPDATE", changedBy: actor.sub,
      after: { status: "CANCELLED" }, note: input.reason.trim(),
    })
    return po
  })
}

export async function listCustomerPos(
  filter: { opportunityId?: string; status?: "OPEN" | "COMPLETE" | "CANCELLED" },
  actor: AccessTokenPayload
) {
  if (!isFinance(actor)) {
    if (!filter.opportunityId) throw new AppError(400, "Choose a deal to list its customer POs")
    await assertDealAccess(prisma, actor, filter.opportunityId)
  }
  return prisma.customerPo.findMany({
    where: { opportunityId: filter.opportunityId, status: filter.status },
    include: PO_INCLUDE,
    orderBy: { date: "desc" },
  })
}

export async function getCustomerPo(id: string, actor: AccessTokenPayload) {
  const po = await prisma.customerPo.findUnique({ where: { id }, include: PO_INCLUDE })
  if (!po) throw new AppError(404, "Customer PO not found")
  await assertDealAccess(prisma, actor, po.opportunityId)
  return po
}
