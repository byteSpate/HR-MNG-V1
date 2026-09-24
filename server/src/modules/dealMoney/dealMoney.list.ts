import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { env } from "../../config/env"

const ZERO = new Prisma.Decimal(0)
const PAGE_SIZE = 50

export interface DealMoneyListRow {
  id: string
  serial: string
  name: string
  customerName: string | null
  sold: string
  cost: string
  profit: string
  stillOwed: string
  waiting: number
}

/**
 * Deals Won since go-live, newest first, with search across the deal
 * itself and the documents attached to it: its serial and name, its
 * customer's legal name, a customer PO number, a supplier bill number, and
 * an invoice number (through the PO it belongs to).
 */
export async function listDealMoney(query: { search?: string; page?: number }): Promise<{ rows: DealMoneyListRow[]; total: number }> {
  const page = query.page ?? 1
  const goLive = new Date(`${env.SALES_GO_LIVE}T00:00:00.000Z`)
  const search = query.search?.trim()

  const where: Prisma.OpportunityWhereInput = {
    status: "WON",
    closedAt: { gte: goLive },
    ...(search
      ? {
          OR: [
            { serial: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
            { salesAccount: { customer: { legalName: { contains: search, mode: "insensitive" } } } },
            { customerPos: { some: { customerPoNumber: { contains: search, mode: "insensitive" } } } },
            { customerPos: { some: { invoices: { some: { invoiceNumber: { contains: search, mode: "insensitive" } } } } } },
            { supplierBills: { some: { billNumber: { contains: search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  }

  const [deals, total] = await Promise.all([
    prisma.opportunity.findMany({
      where,
      select: { id: true, serial: true, name: true, salesAccount: { select: { customer: { select: { legalName: true } } } } },
      orderBy: { closedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.opportunity.count({ where }),
  ])

  if (deals.length === 0) return { rows: [], total }
  const ids = deals.map((d) => d.id)

  const [invoices, billCosts, waitingInvoices, waitingBills, waitingCustomerCreditNotes, waitingSupplierCreditNotes] = await Promise.all([
    prisma.invoice.findMany({
      where: { po: { opportunityId: { in: ids } }, status: "APPROVED" },
      select: {
        po: { select: { opportunityId: true } },
        lines: { select: { amount: true, vatAmount: true } },
        allocations: { where: { receipt: { status: "APPROVED" } }, select: { amount: true } },
        creditNotes: { where: { status: "APPROVED" }, select: { lines: { select: { amount: true, vatAmount: true } } } },
      },
    }),
    prisma.journalLine.groupBy({
      by: ["opportunityId"],
      where: { opportunityId: { in: ids }, account: { type: "EXPENSE" }, journal: { status: { in: ["POSTED", "REVERSED"] } } },
      _sum: { debit: true, credit: true },
    }),
    prisma.invoice.findMany({
      where: { po: { opportunityId: { in: ids } }, status: "DRAFT", rejectionNote: null },
      select: { po: { select: { opportunityId: true } } },
    }),
    prisma.supplierBill.groupBy({
      by: ["opportunityId"],
      where: { opportunityId: { in: ids }, status: "DRAFT", rejectionNote: null },
      _count: { _all: true },
    }),
    prisma.customerCreditNote.findMany({
      where: { invoice: { po: { opportunityId: { in: ids } } }, status: "DRAFT", rejectionNote: null },
      select: { invoice: { select: { po: { select: { opportunityId: true } } } } },
    }),
    prisma.supplierCreditNote.findMany({
      where: { bill: { opportunityId: { in: ids } }, status: "DRAFT", rejectionNote: null },
      select: { bill: { select: { opportunityId: true } } },
    }),
  ])

  const soldByDeal = new Map<string, Prisma.Decimal>()
  const stillOwedByDeal = new Map<string, Prisma.Decimal>()
  for (const inv of invoices) {
    const oppId = inv.po.opportunityId
    const lineTotal = inv.lines.reduce((s, l) => s.plus(l.amount), ZERO)
    const creditedTotal = inv.creditNotes.reduce((s, cn) => s.plus(cn.lines.reduce((s2, l) => s2.plus(l.amount), ZERO)), ZERO)
    soldByDeal.set(oppId, (soldByDeal.get(oppId) ?? ZERO).plus(lineTotal).minus(creditedTotal))

    const gross = inv.lines.reduce((s, l) => s.plus(l.amount).plus(l.vatAmount), ZERO)
    const collected = inv.allocations.reduce((s, a) => s.plus(a.amount), ZERO)
    const creditedGross = inv.creditNotes.reduce(
      (s, cn) => s.plus(cn.lines.reduce((s2, l) => s2.plus(l.amount).plus(l.vatAmount), ZERO)),
      ZERO
    )
    stillOwedByDeal.set(oppId, (stillOwedByDeal.get(oppId) ?? ZERO).plus(gross).minus(collected).minus(creditedGross))
  }

  const costByDeal = new Map(billCosts.map((c) => [c.opportunityId, (c._sum.debit ?? ZERO).minus(c._sum.credit ?? ZERO)]))

  const waitingByDeal = new Map<string, number>()
  const bump = (oppId: string) => waitingByDeal.set(oppId, (waitingByDeal.get(oppId) ?? 0) + 1)
  for (const i of waitingInvoices) bump(i.po.opportunityId)
  for (const b of waitingBills) waitingByDeal.set(b.opportunityId, (waitingByDeal.get(b.opportunityId) ?? 0) + b._count._all)
  for (const cn of waitingCustomerCreditNotes) bump(cn.invoice.po.opportunityId)
  for (const cn of waitingSupplierCreditNotes) bump(cn.bill.opportunityId)

  const rows = deals.map((deal) => {
    const sold = soldByDeal.get(deal.id) ?? ZERO
    const cost = costByDeal.get(deal.id) ?? ZERO
    return {
      id: deal.id,
      serial: deal.serial,
      name: deal.name,
      customerName: deal.salesAccount.customer?.legalName ?? null,
      sold: sold.toFixed(2),
      cost: cost.toFixed(2),
      profit: sold.minus(cost).toFixed(2),
      stillOwed: (stillOwedByDeal.get(deal.id) ?? ZERO).toFixed(2),
      waiting: waitingByDeal.get(deal.id) ?? 0,
    }
  })

  return { rows, total }
}
