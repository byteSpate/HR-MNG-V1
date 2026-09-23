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

/** The customer's go-live opening balance less approved receipts against
 *  it — the same shape as getInvoiceOutstanding, for the debt that has no
 *  invoice behind it. */
export function getCustomerOpeningOutstanding(ob: { amount: Prisma.Decimal; allocations: Array<{ amount: Prisma.Decimal }> }): Prisma.Decimal {
  return ob.allocations.reduce((left, a) => left.minus(a.amount), new Prisma.Decimal(ob.amount))
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
  invoiceId: string | null
  openingBalanceId: string | null
  label: string
  customerId: string
  customerName: string
  dealSerial: string | null
  dueDate: Date
  outstanding: string
  bucket: AgeingBucket
}

/** design §4: what customers owe on approved invoices, plus what they still
 *  owed on go-live (Review Focus 3), aged from each row's due date. Mirrors
 *  Phase 2's getSupplierAgeing exactly, on the receivables side. */
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
      openingBalanceId: null,
      label: `Invoice ${invoice.invoiceNumber}`,
      customerId: invoice.customerId,
      customerName: invoice.customer.legalName,
      dealSerial: invoice.po.opportunity.serial,
      dueDate: invoice.dueDate,
      outstanding: outstanding.toFixed(2),
      bucket: bucketFor(daysPastDue),
    })
  }

  const openings = await prisma.customerOpeningBalance.findMany({
    select: {
      id: true, customerId: true, amount: true, asOf: true,
      customer: { select: { legalName: true } },
      allocations: { where: { receipt: { status: "APPROVED" } }, select: { amount: true } },
    },
  })
  for (const ob of openings) {
    const outstanding = getCustomerOpeningOutstanding(ob)
    if (outstanding.lessThanOrEqualTo(0)) continue

    const daysPastDue = Math.floor((asOf.getTime() - ob.asOf.getTime()) / DAY_MS)
    rows.push({
      invoiceId: null,
      openingBalanceId: ob.id,
      label: "Opening balance",
      customerId: ob.customerId,
      customerName: ob.customer.legalName,
      dealSerial: null,
      dueDate: ob.asOf,
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
  advancesHeld: string
}

/** design §4: sum of customer balances must equal account 1220. Reads the
 *  account codes through the RECEIPT posting rules rather than hard-coding
 *  them, so a re-pointed rule moves the tie-out with it. 2160 (customer
 *  advances not yet matched) is shown beside the tie-out, never netted
 *  into it — they are different accounts. */
export async function getCustomerControlTieOut(): Promise<CustomerTieOut> {
  const ageing = await getCustomerAgeing()
  const subledgerTotal = ageing.reduce((sum, row) => sum.plus(row.outstanding), ZERO)

  const rules = await loadRules(prisma, "RECEIPT")
  const receivableCode = resolveAccountCode(rules, "RECEIVABLE")
  const advanceCode = resolveAccountCode(rules, "ADVANCE")

  const receivableAccount = await prisma.account.findUniqueOrThrow({ where: { code: receivableCode }, select: { id: true } })
  const receivableAgg = await prisma.journalLine.aggregate({
    where: { accountId: receivableAccount.id, journal: { status: { in: ["POSTED", "REVERSED"] } } },
    _sum: { debit: true, credit: true },
  })
  // An asset's normal balance is a debit, so the GL figure is debit minus credit.
  const glBalance = (receivableAgg._sum.debit ?? ZERO).minus(receivableAgg._sum.credit ?? ZERO)

  const advanceAccount = await prisma.account.findUniqueOrThrow({ where: { code: advanceCode }, select: { id: true } })
  const advanceAgg = await prisma.journalLine.aggregate({
    where: { accountId: advanceAccount.id, journal: { status: { in: ["POSTED", "REVERSED"] } } },
    _sum: { debit: true, credit: true },
  })
  // A liability's normal balance is a credit.
  const advancesHeld = (advanceAgg._sum.credit ?? ZERO).minus(advanceAgg._sum.debit ?? ZERO)

  return {
    subledgerTotal: subledgerTotal.toFixed(2),
    glBalance: glBalance.toFixed(2),
    ties: subledgerTotal.equals(glBalance),
    advancesHeld: advancesHeld.toFixed(2),
  }
}
