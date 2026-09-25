import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import { getInvoiceOutstanding, OUTSTANDING_SELECT } from "./receivables.reports"
import type { OutstandingInput } from "./receivables.reports"
import type { CreateCustomerCreditNoteInput } from "./customerCreditNote.validators"

const ZERO = new Prisma.Decimal(0)

export const CREDIT_NOTE_INCLUDE = {
  customer: { select: { id: true, legalName: true } },
  invoice: { select: { id: true, invoiceNumber: true } },
  lines: { include: { invoiceLine: { select: { description: true } } } },
} satisfies Prisma.CustomerCreditNoteInclude

const INVOICE_FOR_CREDIT = {
  // amount/vatAmount are also what getInvoiceOutstanding (called on this
  // same object below) reads off each line; OUTSTANDING_SELECT.lines can't
  // be spread here too, since a relation cannot have two `select` blocks.
  lines: {
    select: {
      id: true, description: true, amount: true, vatAmount: true,
      // Only draft and approved notes count against what is left: a
      // rejected/never-approved note leaves nothing behind, and there is
      // no rejection state in this design, so every stored line counts.
      creditNoteLines: { select: { amount: true, vatAmount: true } },
    },
  },
  allocations: OUTSTANDING_SELECT.allocations,
  creditNotes: OUTSTANDING_SELECT.creditNotes,
} satisfies Prisma.InvoiceInclude

type InvoiceForCredit = Prisma.InvoiceGetPayload<{ include: typeof INVOICE_FOR_CREDIT }>

/** Throws unless the note's gross fits within what the invoice still
 *  owes. Crediting more would leave the customer in credit, and refunds
 *  are not recorded in this system yet (a planning default awaiting the
 *  owner's confirmation, spec §6 "Phase 3 — decisions"). */
export function assertWithinOutstanding(invoice: OutstandingInput & { invoiceNumber: string }, gross: Prisma.Decimal): void {
  const owed = getInvoiceOutstanding(invoice)
  if (gross.greaterThan(owed)) {
    throw new AppError(
      400,
      `Invoice ${invoice.invoiceNumber} only has ${owed.toFixed(2)} left to collect. Crediting ${gross.toFixed(2)} would leave the customer in credit, and refunds are not recorded in this system yet.`
    )
  }
}

/**
 * VAT on part of an invoice line, at the rate that line actually charged:
 * its own stored vatAmount / amount. Never the VAT code's rate today, which
 * Settings can change after the invoice was approved (final review Fix 2).
 * The same ratio the client previews in `credit-note-dialog.tsx`.
 */
function invoiceLineVat(line: { amount: Prisma.Decimal; vatAmount: Prisma.Decimal }, amount: Prisma.Decimal): Prisma.Decimal {
  if (line.amount.isZero()) return ZERO
  return new Prisma.Decimal(amount.times(line.vatAmount).dividedBy(line.amount).toFixed(2))
}

function buildLineRows(invoice: InvoiceForCredit, lines: CreateCustomerCreditNoteInput["lines"]) {
  const byId = new Map(invoice.lines.map((l) => [l.id, l]))
  const rows = lines.map((l) => {
    const invoiceLine = byId.get(l.invoiceLineId)
    if (!invoiceLine) throw new AppError(400, `A line on this credit note is not a line on invoice ${invoice.invoiceNumber}`)

    const creditedSoFar = invoiceLine.creditNoteLines.reduce((s, cl) => s.plus(cl.amount), ZERO)
    const vatCreditedSoFar = invoiceLine.creditNoteLines.reduce((s, cl) => s.plus(cl.vatAmount), ZERO)
    const left = invoiceLine.amount.minus(creditedSoFar)
    const vatLeft = invoiceLine.vatAmount.minus(vatCreditedSoFar)

    const amount = new Prisma.Decimal(l.amount)
    if (amount.greaterThan(left)) throw new AppError(400, `Only ${left.toFixed(2)} is left to credit on ${invoiceLine.description}`)

    // Crediting everything left on a line credits exactly the VAT left,
    // so no paisa residue is stranded on 2150 by rounding.
    const vatAmount = amount.equals(left) ? vatLeft : invoiceLineVat(invoiceLine, amount)
    return { invoiceLineId: l.invoiceLineId, amount: amount.toFixed(2), vatAmount: vatAmount.toFixed(2) }
  })
  return rows
}

export async function createCustomerCreditNote(input: CreateCustomerCreditNoteInput, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id: input.invoiceId }, include: INVOICE_FOR_CREDIT })
    if (!invoice) throw new AppError(404, "Invoice not found")
    if (invoice.status !== "APPROVED") throw new AppError(400, "Only an approved invoice can be credited. Edit the draft instead.")

    const lines = buildLineRows(invoice, input.lines)
    const gross = lines.reduce((s, l) => s.plus(l.amount).plus(l.vatAmount), ZERO)
    assertWithinOutstanding(invoice, gross)

    const note = await tx.customerCreditNote.create({
      data: {
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        date: new Date(input.date),
        reason: input.reason.trim(),
        createdBy: actor.sub,
        lines: { create: lines },
      },
      include: CREDIT_NOTE_INCLUDE,
    })
    await writeAudit(tx, {
      entity: "CUSTOMER_CREDIT_NOTE", entityId: note.id, action: "CREATE", changedBy: actor.sub,
      after: { invoiceId: invoice.id, reason: note.reason },
    })
    return note
  })
}

export async function listCustomerCreditNotes(filter: { status?: "DRAFT" | "APPROVED"; invoiceId?: string }) {
  return prisma.customerCreditNote.findMany({ where: filter, include: CREDIT_NOTE_INCLUDE, orderBy: { date: "desc" } })
}

export async function getCustomerCreditNote(id: string) {
  const note = await prisma.customerCreditNote.findUnique({ where: { id }, include: CREDIT_NOTE_INCLUDE })
  if (!note) throw new AppError(404, "Customer credit note not found")
  return note
}
