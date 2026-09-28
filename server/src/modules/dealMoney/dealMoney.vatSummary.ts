import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { loadRules, resolveAccountCode } from "../posting/posting.rules"

const ZERO = new Prisma.Decimal(0)

export interface VatSummary {
  onInvoices: string
  onBills: string
  difference: string
  withheldByCustomers: string
  /** VAT on approved invoice lines whose rate was typed by hand, in the range. */
  typedOnInvoices: string
  /** The same for approved supplier bill lines. */
  typedOnBills: string
}

/** Posted debits minus credits for an account, over a date range, counting
 *  only journals CUSTOMER or SUPPLIER sourced — a hand-typed VAT
 *  settlement is not VAT on invoices or bills. A reversal journal carries
 *  no `sourceModule` of its own (postReversalNow sets none), so it is
 *  included by checking the journal it reverses instead — otherwise a
 *  reversed receipt's original journal stays counted while its offsetting
 *  reversal is silently dropped, and the reversed amount never nets to
 *  zero. */
async function debitLessCredit(accountCode: string, from: Date, to: Date): Promise<Prisma.Decimal> {
  const account = await prisma.account.findUniqueOrThrow({ where: { code: accountCode }, select: { id: true } })
  const agg = await prisma.journalLine.aggregate({
    where: {
      accountId: account.id,
      journal: {
        status: { in: ["POSTED", "REVERSED"] },
        OR: [
          { sourceModule: { in: ["CUSTOMER", "SUPPLIER"] } },
          { reverses: { sourceModule: { in: ["CUSTOMER", "SUPPLIER"] } } },
        ],
        date: { gte: from, lt: to },
      },
    },
    _sum: { debit: true, credit: true },
  })
  return (agg._sum.debit ?? ZERO).minus(agg._sum.credit ?? ZERO)
}

/**
 * VAT on invoices (2150, a liability so read credit less debit), VAT on
 * supplier bills (1233, an asset so read debit less credit), the
 * difference between them, and what customers withheld at source (1234).
 * Not a VAT return — the app records VAT, it does not file it (spec).
 */
export async function getVatSummary(from: string, to: string): Promise<VatSummary> {
  const [invoiceRules, billRules, receiptRules] = await Promise.all([
    loadRules(prisma, "INVOICE"),
    loadRules(prisma, "SUPPLIER_BILL"),
    loadRules(prisma, "RECEIPT"),
  ])

  const fromDate = new Date(`${from}T00:00:00.000Z`)
  // `to` is inclusive: the next day, exclusive, catches every journal dated
  // on the end day itself.
  const toDate = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000)

  const [onInvoicesCreditLessDebit, onBills, withheldByCustomers] = await Promise.all([
    debitLessCredit(resolveAccountCode(invoiceRules, "VAT"), fromDate, toDate).then((v) => v.negated()),
    debitLessCredit(resolveAccountCode(billRules, "VAT"), fromDate, toDate),
    debitLessCredit(resolveAccountCode(receiptRules, "VDS"), fromDate, toDate),
  ])

  // How much of the totals above came from a % typed on a line rather than
  // from a VAT code. It is already inside the totals, not extra.
  const [typedInvoices, typedBills] = await Promise.all([
    prisma.invoiceLine.aggregate({
      where: { vatMethod: "MANUAL", invoice: { status: "APPROVED", date: { gte: fromDate, lt: toDate } } },
      _sum: { vatAmount: true },
    }),
    prisma.supplierBillLine.aggregate({
      where: { vatMethod: "MANUAL", bill: { status: "APPROVED", date: { gte: fromDate, lt: toDate } } },
      _sum: { vatAmount: true },
    }),
  ])

  return {
    onInvoices: onInvoicesCreditLessDebit.toFixed(2),
    onBills: onBills.toFixed(2),
    difference: onInvoicesCreditLessDebit.minus(onBills).toFixed(2),
    withheldByCustomers: withheldByCustomers.toFixed(2),
    typedOnInvoices: (typedInvoices._sum.vatAmount ?? ZERO).toFixed(2),
    typedOnBills: (typedBills._sum.vatAmount ?? ZERO).toFixed(2),
  }
}
