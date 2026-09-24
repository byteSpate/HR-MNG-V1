import { Prisma } from "../../generated/prisma/client"
import type { Prisma as PrismaNamespace } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import { poLineRemaining } from "./customerPo.service"
import { loadActiveVatRates, vatFor } from "./receivables.vat"
import type { CreateInvoiceInput, UpdateInvoiceInput } from "./invoice.validators"

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002"
}

const PO_FOR_INVOICING = {
  customer: { select: { id: true, legalName: true, paymentDays: true } },
  lines: {
    orderBy: { order: "asc" },
    include: { invoiceLines: { where: { invoice: { status: { in: ["DRAFT", "APPROVED"] } } }, select: { amount: true } } },
  },
} satisfies Prisma.CustomerPoInclude

export const INVOICE_INCLUDE = {
  customer: { select: { id: true, legalName: true } },
  po: { select: { id: true, serial: true, customerPoNumber: true, opportunity: { select: { id: true, serial: true, name: true } } } },
  lines: { include: { poLine: { select: { kind: true } }, vatCode: true } },
} satisfies Prisma.InvoiceInclude

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

type PoForInvoicing = Prisma.CustomerPoGetPayload<{ include: typeof PO_FOR_INVOICING }>

async function buildLineRows(tx: PrismaNamespace.TransactionClient, po: PoForInvoicing, lines: CreateInvoiceInput["lines"]) {
  const byId = new Map(po.lines.map((l) => [l.id, l]))
  const wanted = new Map<string, Prisma.Decimal>()
  for (const l of lines) {
    const poLine = byId.get(l.poLineId)
    if (!poLine) throw new AppError(400, `A line on this invoice is not a line on PO ${po.serial}`)
    wanted.set(l.poLineId, (wanted.get(l.poLineId) ?? new Prisma.Decimal(0)).plus(l.amount))
  }
  for (const [id, amount] of wanted) {
    const poLine = byId.get(id)!
    const left = poLineRemaining(poLine)
    if (amount.greaterThan(left)) throw new AppError(400, `Only ${left.toFixed(2)} is left to invoice on ${poLine.description}`)
  }

  const rates = await loadActiveVatRates(tx, lines.map((l) => l.vatCodeId ?? byId.get(l.poLineId)!.vatCodeId))
  return lines.map((l) => {
    const poLine = byId.get(l.poLineId)!
    const vatCodeId = l.vatCodeId ?? poLine.vatCodeId
    const amount = new Prisma.Decimal(l.amount)
    return {
      poLineId: l.poLineId,
      description: l.description?.trim() || poLine.description,
      amount: amount.toFixed(2),
      vatCodeId,
      vatAmount: vatFor(amount, rates.get(vatCodeId)!).toFixed(2),
    }
  })
}

async function loadOpenPo(tx: PrismaNamespace.TransactionClient, poId: string): Promise<PoForInvoicing> {
  const po = await tx.customerPo.findUnique({ where: { id: poId }, include: PO_FOR_INVOICING })
  if (!po) throw new AppError(404, "Customer PO not found")
  if (po.status !== "OPEN") throw new AppError(400, `PO ${po.serial} is ${po.status.toLowerCase()}, so it cannot be invoiced`)
  return po
}

export async function createInvoice(input: CreateInvoiceInput, actor: AccessTokenPayload) {
  try {
    return await prisma.$transaction(async (tx) => {
      const po = await loadOpenPo(tx, input.poId)
      const date = new Date(input.date)
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber: input.invoiceNumber.trim(),
          poId: po.id,
          customerId: po.customerId,
          date,
          dueDate: input.dueDate ? new Date(input.dueDate) : addDays(date, po.customer.paymentDays),
          createdBy: actor.sub,
          lines: { create: await buildLineRows(tx, po, input.lines) },
        },
        include: INVOICE_INCLUDE,
      })
      await writeAudit(tx, {
        entity: "INVOICE", entityId: invoice.id, action: "CREATE", changedBy: actor.sub,
        after: { invoiceNumber: invoice.invoiceNumber, poId: po.id },
      })
      return invoice
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, `An invoice numbered ${input.invoiceNumber.trim()} is already recorded`)
    throw err
  }
}

export async function updateInvoice(id: string, input: UpdateInvoiceInput, actor: AccessTokenPayload) {
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findUnique({ where: { id } })
      if (!existing) throw new AppError(404, "Invoice not found")
      if (existing.status !== "DRAFT") throw new AppError(409, "Only a draft invoice can be edited")

      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } })
      const po = await loadOpenPo(tx, existing.poId)
      const date = new Date(input.date)

      const invoice = await tx.invoice.update({
        where: { id },
        data: {
          invoiceNumber: input.invoiceNumber.trim(),
          date,
          dueDate: input.dueDate ? new Date(input.dueDate) : addDays(date, po.customer.paymentDays),
          lines: { create: await buildLineRows(tx, po, input.lines) },
          // Saving a sent-back draft again clears the note (Task 8): the
          // person who prepared it has had their chance to fix it.
          rejectionNote: null,
          sentBackBy: null,
          sentBackAt: null,
        },
        include: INVOICE_INCLUDE,
      })
      await writeAudit(tx, { entity: "INVOICE", entityId: id, action: "UPDATE", changedBy: actor.sub })
      return invoice
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, `An invoice numbered ${input.invoiceNumber.trim()} is already recorded`)
    throw err
  }
}

export async function listInvoiceablePos() {
  const pos = await prisma.customerPo.findMany({
    where: { status: "OPEN" },
    include: { ...PO_FOR_INVOICING, opportunity: { select: { id: true, serial: true, name: true } } },
    orderBy: { date: "desc" },
  })
  return pos
    .map((po) => ({
      id: po.id,
      serial: po.serial,
      customerPoNumber: po.customerPoNumber,
      customer: po.customer,
      opportunity: po.opportunity,
      lines: po.lines.map((l) => ({
        id: l.id, description: l.description, kind: l.kind, amount: l.amount.toFixed(2), vatCodeId: l.vatCodeId,
        remaining: poLineRemaining(l).toFixed(2),
      })),
    }))
    .filter((po) => po.lines.some((l) => Number(l.remaining) > 0))
}

export async function listInvoices(filter: { status?: "DRAFT" | "APPROVED"; customerId?: string }) {
  return prisma.invoice.findMany({ where: filter, include: INVOICE_INCLUDE, orderBy: { date: "desc" } })
}

export async function getInvoice(id: string) {
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: INVOICE_INCLUDE })
  if (!invoice) throw new AppError(404, "Invoice not found")
  return invoice
}
