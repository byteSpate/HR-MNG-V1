import prisma from "../../../config/prisma"
import { Prisma } from "../../../generated/prisma/client"
import { officeToday } from "../../attendance/attendance.time"
import { toMoneyString } from "../../payroll/payroll.money"
import { getInvoiceOutstanding } from "../../receivables/receivables.reports"
import type { PaymentRow, PaymentsTable } from "../sales.types"
import type { ListPaymentsQuery } from "./payments.validators"

/**
 * Payments, for Sales Admins and Super Admins (owner, 2026-10-18): each
 * approved invoice, what was received against it, and how much is still
 * owed. The balance is `getInvoiceOutstanding`, the same figure the Money
 * section shows, so the two can never disagree. Draft and reversed documents
 * never count.
 */

const ZERO = new Prisma.Decimal(0)
const day = (d: Date) => d.toISOString().slice(0, 10)

const PAYMENT_INCLUDE = {
  po: { select: { opportunity: { select: { id: true, serial: true, name: true, salesAccount: { select: { id: true, name: true } } } } } },
  lines: { select: { amount: true, vatAmount: true } },
  allocations: {
    where: { receipt: { status: "APPROVED" } },
    select: { amount: true, receipt: { select: { id: true, number: true, date: true, paymentMethod: true } } },
    orderBy: [{ receipt: { createdAt: "asc" } }, { id: "asc" }],
  },
  creditNotes: { where: { status: "APPROVED" }, select: { lines: { select: { amount: true, vatAmount: true } } } },
} satisfies Prisma.InvoiceInclude

type InvoiceForPayments = Prisma.InvoiceGetPayload<{ include: typeof PAYMENT_INCLUDE }>

function rowOf(inv: InvoiceForPayments, today: Date): PaymentRow {
  const gross = inv.lines.reduce((s, l) => s.plus(l.amount).plus(l.vatAmount), ZERO)
  const credited = inv.creditNotes.reduce((s, n) => s.plus(n.lines.reduce((t, l) => t.plus(l.amount).plus(l.vatAmount), ZERO)), ZERO)
  const invoiceTotal = gross.minus(credited)
  const received = inv.allocations.reduce((s, a) => s.plus(a.amount), ZERO)
  const balance = getInvoiceOutstanding(inv)
  // No total means nothing to be a percentage of: "-", never NaN% or 0%.
  const percentPaid = invoiceTotal.greaterThan(0) ? Number(received.dividedBy(invoiceTotal).times(100).toDecimalPlaces(1)) : null
  const status: PaymentRow["status"] = balance.lessThanOrEqualTo(0)
    ? "PAID"
    : inv.dueDate.getTime() < today.getTime()
      ? "OVERDUE"
      : received.greaterThan(0)
        ? "PART_PAID"
        : "UNPAID"
  const opp = inv.po.opportunity
  return {
    invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, date: day(inv.date), dueDate: day(inv.dueDate),
    opportunityId: opp.id, opportunityName: opp.name, accountId: opp.salesAccount.id, accountName: opp.salesAccount.name,
    invoiceTotal: toMoneyString(invoiceTotal), received: toMoneyString(received), balance: toMoneyString(balance),
    percentPaid, status,
    receipts: inv.allocations.map((a) => ({
      number: a.receipt.number, date: day(a.receipt.date), method: a.receipt.paymentMethod, amount: toMoneyString(a.amount),
    })),
  }
}

/** One row per approved invoice of the account or Opportunity (or all), oldest due date first. */
export async function paymentRows(filter: Pick<ListPaymentsQuery, "accountId" | "opportunityId">, today: Date): Promise<PaymentRow[]> {
  const where: Prisma.InvoiceWhereInput = { status: "APPROVED" }
  if (filter.opportunityId) where.po = { opportunityId: filter.opportunityId }
  else if (filter.accountId) where.po = { opportunity: { salesAccountId: filter.accountId } }
  const invoices = await prisma.invoice.findMany({ where, include: PAYMENT_INCLUDE, orderBy: [{ dueDate: "asc" }, { id: "asc" }] })
  return invoices.map((inv) => rowOf(inv, today))
}

export async function listPayments(query: ListPaymentsQuery, today: Date = officeToday()): Promise<PaymentsTable> {
  const all = await paymentRows(query, today)
  const rows = query.open ? all.filter((r) => r.status !== "PAID") : all
  const add = (pick: (r: PaymentRow) => string) => toMoneyString(rows.reduce((s, r) => s.plus(pick(r)), ZERO))
  return { rows, totals: { invoiceTotal: add((r) => r.invoiceTotal), received: add((r) => r.received), balance: add((r) => r.balance) } }
}
