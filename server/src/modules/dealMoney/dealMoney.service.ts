import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { env } from "../../config/env"
import type { AccessTokenPayload } from "../auth/auth.types"
import { resolveActors } from "../../utils/actors"
import { assertDealAccess, isFinance } from "../receivables/receivables.access"
import { PO_INCLUDE } from "../receivables/customerPo.service"
import { RECEIPT_INCLUDE } from "../receivables/receipt.service"
import { getInvoiceOutstanding, getInvoiceSold } from "../receivables/receivables.reports"
import { dealCostLineWhere } from "./dealMoney.cost"
import { moneyNotRecordedReason } from "./dealMoney.goLive"
import { DEAL_BILL_INCLUDE, DEAL_INVOICE_INCLUDE, DEAL_PAYMENT_INCLUDE } from "./dealMoney.types"
import type { DealMoney, InvoiceRowWithActor, SupplierBillRowWithActor } from "./dealMoney.types"

const ZERO = new Prisma.Decimal(0)

/**
 * One payload for a deal's Money section, shown in two places (the deal
 * page's Money section and the standalone deal money page). Access is
 * checked before anything else is read (Review Focus 5): a sales user who
 * cannot see the deal never causes a single money query to run, so no
 * amount ever leaks. A sales user who can see the deal still sees no cost,
 * profit, bills or payments — those queries are skipped entirely for them,
 * not merely hidden in the response.
 */
export async function getDealMoney(opportunityId: string, actor: AccessTokenPayload): Promise<DealMoney> {
  const deal = await assertDealAccess(prisma, actor, opportunityId)

  // A deal whose money this app never recorded (not Won, or Won before
  // go-live) gets no numbers at all rather than a row of zeros, and no
  // money query runs for it (final review Fix 3).
  const notRecordedReason = moneyNotRecordedReason(deal, env.SALES_GO_LIVE)
  if (notRecordedReason) {
    return {
      moneyAllowed: false,
      notRecordedReason,
      goLiveDate: env.SALES_GO_LIVE,
      deal: { id: deal.id, serial: deal.serial, name: deal.name },
    }
  }

  const canSeeCost = isFinance(actor)
  const canEdit = isFinance(actor)

  const [customer, pos, invoices, receipts, productLines, bills, supplierPayments, costAgg] = await Promise.all([
    prisma.customer.findUnique({
      where: { salesAccountId: deal.salesAccountId },
      select: { id: true, legalName: true, billingAddress: true, paymentDays: true },
    }),
    prisma.customerPo.findMany({ where: { opportunityId }, include: PO_INCLUDE, orderBy: { date: "desc" } }),
    prisma.invoice.findMany({ where: { po: { opportunityId } }, include: DEAL_INVOICE_INCLUDE, orderBy: { date: "desc" } }),
    prisma.receipt.findMany({ where: { opportunityId }, include: RECEIPT_INCLUDE, orderBy: { date: "desc" } }),
    prisma.opportunityLine.findMany({
      where: { opportunityId },
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: { order: "asc" },
    }),
    canSeeCost
      ? prisma.supplierBill.findMany({ where: { opportunityId }, include: DEAL_BILL_INCLUDE, orderBy: { date: "desc" } })
      : Promise.resolve(null),
    canSeeCost
      ? prisma.supplierPayment.findMany({ where: { opportunityId }, include: DEAL_PAYMENT_INCLUDE, orderBy: { date: "desc" } })
      : Promise.resolve(null),
    canSeeCost
      ? dealCostLineWhere().then((costWhere) =>
          prisma.journalLine.aggregate({ where: { ...costWhere, opportunityId }, _sum: { debit: true, credit: true } })
        )
      : Promise.resolve(null),
  ])

  // "Sent back by {name}" (Money section, Invoiced and Bought) needs a name,
  // and `sentBackBy` is a bare user id with no Prisma relation — see
  // `InvoiceRowWithActor` / `SupplierBillRowWithActor`. Resolved once, in one
  // query per document kind, for every row that has one.
  const sentBackActors = await resolveActors([
    ...invoices.map((inv) => inv.sentBackBy),
    ...(bills ?? []).map((bill) => bill.sentBackBy),
  ])
  const invoicesWithActor: InvoiceRowWithActor[] = invoices.map((inv) => ({
    ...inv,
    sentBackByUser: inv.sentBackBy ? (sentBackActors[inv.sentBackBy] ?? null) : null,
  }))
  const billsWithActor: SupplierBillRowWithActor[] | null =
    bills === null
      ? null
      : bills.map((bill) => ({
          ...bill,
          sentBackByUser: bill.sentBackBy ? (sentBackActors[bill.sentBackBy] ?? null) : null,
        }))

  // The four numbers (spec, "The four numbers"). Drafts never count: an
  // approved invoice or credit note is the only kind that moved the ledger.
  const approvedInvoices = invoicesWithActor.filter((i) => i.status === "APPROVED")
  const sold = approvedInvoices.reduce(
    (sum, inv) =>
      sum.plus(
        getInvoiceSold({
          lines: inv.lines,
          creditNotes: inv.creditNotes.filter((cn) => cn.status === "APPROVED"),
        })
      ),
    ZERO
  )
  const stillOwed = approvedInvoices.reduce(
    (sum, inv) =>
      sum.plus(
        getInvoiceOutstanding({
          lines: inv.lines,
          allocations: inv.allocations,
          creditNotes: inv.creditNotes.filter((cn) => cn.status === "APPROVED"),
        })
      ),
    ZERO
  )
  const cost = costAgg ? (costAgg._sum.debit ?? ZERO).minus(costAgg._sum.credit ?? ZERO) : null
  const profit = cost !== null ? sold.minus(cost) : null

  return {
    moneyAllowed: true,
    deal: {
      id: deal.id,
      serial: deal.serial,
      name: deal.name,
      customer: customer
        ? { id: customer.id, legalName: customer.legalName, billingAddress: customer.billingAddress, paymentDays: customer.paymentDays }
        : null,
    },
    canSeeCost,
    canEdit,
    numbers: {
      sold: sold.toFixed(2),
      stillOwed: stillOwed.toFixed(2),
      cost: cost !== null ? cost.toFixed(2) : null,
      profit: profit !== null ? profit.toFixed(2) : null,
    },
    pos,
    bills: billsWithActor,
    supplierPayments,
    invoices: invoicesWithActor,
    receipts,
    productLines: productLines.map((l) => ({
      id: l.id,
      product: l.product,
      model: l.model,
      quantity: l.quantity,
      supplier: l.supplier ? { id: l.supplier.id, name: l.supplier.name } : null,
    })),
  }
}
