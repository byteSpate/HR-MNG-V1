import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { loadRules, resolveAccountCode } from "../posting/posting.rules"

const ZERO = new Prisma.Decimal(0)
const DAY_MS = 24 * 60 * 60 * 1000

export interface OutstandingInput {
  lines: Array<{ amount: Prisma.Decimal; vatAmount: Prisma.Decimal }>
  allocations: Array<{ amount: Prisma.Decimal }>
  creditNotes: Array<{ lines: Array<{ amount: Prisma.Decimal; vatAmount: Prisma.Decimal }> }>
}

/** The select every caller of getInvoiceOutstanding needs on the invoice. */
export const OUTSTANDING_SELECT = {
  lines: { select: { amount: true, vatAmount: true } },
  allocations: { where: { receipt: { status: "APPROVED" } }, select: { amount: true } },
  creditNotes: { where: { status: "APPROVED" }, select: { lines: { select: { amount: true, vatAmount: true } } } },
} as const

/** Gross, less approved receipts' allocations (matched advances included),
 *  less approved credit notes. Drafts have not touched 1220, so they never
 *  count — the same rule Phase 2's getBillOutstanding follows. */
export function getInvoiceOutstanding(invoice: OutstandingInput): Prisma.Decimal {
  const gross = invoice.lines.reduce((sum, l) => sum.plus(l.amount).plus(l.vatAmount), ZERO)
  const collected = invoice.allocations.reduce((sum, a) => sum.plus(a.amount), ZERO)
  const credited = invoice.creditNotes.reduce(
    (sum, note) => sum.plus(note.lines.reduce((s, l) => s.plus(l.amount).plus(l.vatAmount), ZERO)),
    ZERO
  )
  return gross.minus(collected).minus(credited)
}

export interface SoldInput {
  lines: Array<{ amount: Prisma.Decimal }>
  creditNotes: Array<{ lines: Array<{ amount: Prisma.Decimal }> }>
}

/** Line total less credited line total (net of VAT) — the "Sold" figure
 *  the Deal Money section and the Deals list both show. Callers pass only
 *  APPROVED credit notes; a DRAFT one has not moved anything yet. */
export function getInvoiceSold(invoice: SoldInput): Prisma.Decimal {
  const lineTotal = invoice.lines.reduce((sum, l) => sum.plus(l.amount), ZERO)
  const credited = invoice.creditNotes.reduce(
    (sum, note) => sum.plus(note.lines.reduce((s, l) => s.plus(l.amount), ZERO)),
    ZERO
  )
  return lineTotal.minus(credited)
}

export type AgeingBucket = "Not due" | "1-30" | "31-60" | "61-90" | "Over 90"

function bucketFor(daysPastDue: number): AgeingBucket {
  if (daysPastDue <= 0) return "Not due"
  if (daysPastDue <= 30) return "1-30"
  if (daysPastDue <= 60) return "31-60"
  if (daysPastDue <= 90) return "61-90"
  return "Over 90"
}

export interface CustomerAgeingRow {
  invoiceId: string
  label: string
  customerId: string
  customerName: string
  dealSerial: string | null
  dueDate: Date
  outstanding: string
  bucket: AgeingBucket
}

/** design §4: what customers owe on approved invoices, aged from each row's
 *  due date. Mirrors Phase 2's getSupplierAgeing exactly, on the
 *  receivables side. */
export async function getCustomerAgeing(asOf: Date = new Date()): Promise<CustomerAgeingRow[]> {
  const invoices = await prisma.invoice.findMany({
    where: { status: "APPROVED" },
    select: {
      id: true, invoiceNumber: true, customerId: true, dueDate: true,
      customer: { select: { legalName: true } },
      po: { select: { opportunity: { select: { serial: true } } } },
      ...OUTSTANDING_SELECT,
    },
  })

  const rows: CustomerAgeingRow[] = []
  for (const invoice of invoices) {
    const outstanding = getInvoiceOutstanding(invoice)
    if (outstanding.lessThanOrEqualTo(0)) continue

    const daysPastDue = Math.floor((asOf.getTime() - invoice.dueDate.getTime()) / DAY_MS)
    rows.push({
      invoiceId: invoice.id,
      label: `Invoice ${invoice.invoiceNumber}`,
      customerId: invoice.customerId,
      customerName: invoice.customer.legalName,
      dealSerial: invoice.po.opportunity.serial,
      dueDate: invoice.dueDate,
      outstanding: outstanding.toFixed(2),
      bucket: bucketFor(daysPastDue),
    })
  }

  rows.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
  return rows
}

export interface CustomerTieOut {
  subledgerTotal: string
  glBalance: string
  ties: boolean
}

/** design §4: sum of customer balances must equal account 1220. Reads the
 *  account code through the RECEIPT posting rules rather than hard-coding
 *  it, so a re-pointed rule moves the tie-out with it. */
export async function getCustomerControlTieOut(): Promise<CustomerTieOut> {
  const ageing = await getCustomerAgeing()
  const subledgerTotal = ageing.reduce((sum, row) => sum.plus(row.outstanding), ZERO)

  const rules = await loadRules(prisma, "RECEIPT")
  const receivableCode = resolveAccountCode(rules, "RECEIVABLE")

  const receivableAccount = await prisma.account.findUniqueOrThrow({ where: { code: receivableCode }, select: { id: true } })
  const receivableAgg = await prisma.journalLine.aggregate({
    where: { accountId: receivableAccount.id, journal: { status: { in: ["POSTED", "REVERSED"] } } },
    _sum: { debit: true, credit: true },
  })
  // An asset's normal balance is a debit, so the GL figure is debit minus credit.
  const glBalance = (receivableAgg._sum.debit ?? ZERO).minus(receivableAgg._sum.credit ?? ZERO)

  return {
    subledgerTotal: subledgerTotal.toFixed(2),
    glBalance: glBalance.toFixed(2),
    ties: subledgerTotal.equals(glBalance),
  }
}
